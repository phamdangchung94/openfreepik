/**
 * Fire-and-forget HTTP POST to a customer-supplied webhook URL.
 *
 * Triggers when /v1/* tasks transition from `pending` → final state
 * (succeeded / failed / refunded). Customer pulled `webhook_url` from
 * the POST body at task-creation time; we persisted it to
 * `usage_logs.customer_webhook_url` and read it back here.
 *
 * Design choices:
 *   - **No retry queue** — single attempt with 10s timeout. Customer
 *     can re-poll /v1/tasks/{id} as fallback. Reliable delivery would
 *     require a separate worker; out of scope for v1.
 *   - **HMAC-SHA256 signature** (Stripe-style, migration 0019) when
 *     the API key has a `webhook_secret_encrypted`. Header format:
 *     `X-Webhook-Signature: t=<unix>,v1=<hex>` where hex = HMAC-SHA256
 *     (secret, "<t>.<body>"). Customer's receiver verifies with their
 *     stored secret. Legacy keys (NULL secret) fall back to unsigned
 *     delivery + log warn.
 *   - **2-second HTTP timeout** caps each call so a slow customer
 *     endpoint can't pile up serverless function time. AbortController
 *     fires the timeout cleanly.
 *   - **Errors swallow** — log warn-level so they show in Vercel
 *     logs but never propagate to the caller (finalize must
 *     succeed regardless of webhook delivery).
 */

import { createHmac, randomUUID } from "node:crypto";
import { errFields, log } from "@/lib/logger";
import { isUnsafeWebhookHost } from "@/lib/api-v1/url-security";

const TIMEOUT_MS = 10_000;

export type CustomerWebhookEvent =
  | "task.succeeded"
  | "task.failed"
  | "task.refunded";

export interface CustomerWebhookPayload {
  task_id: string;
  status: "COMPLETED" | "FAILED" | "REFUNDED";
  endpoint: string;
  video_url: string | null;
  video_url_expires_at: string | null;
  error_message: string | null;
  /** ISO timestamp when the status flip happened (server-side). */
  finalized_at: string;
}

export interface FireWebhookOptions {
  /**
   * Plaintext webhook signing secret resolved from `api_keys.
   * webhook_secret_encrypted` for the key that minted this task. Null
   * for legacy keys → webhook fires unsigned + logs warn.
   */
  signingSecret?: string | null;
}

export async function fireCustomerWebhook(
  url: string,
  event: CustomerWebhookEvent,
  payload: CustomerWebhookPayload,
  opts: FireWebhookOptions = {},
): Promise<void> {
  // Validate URL one more time (was already validated at POST time, but
  // defense in depth — an attacker who could write to usage_logs
  // shouldn't be able to make us POST to arbitrary internal hosts).
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.warn("CUSTOMER_WEBHOOK_BAD_URL", { url, taskId: payload.task_id });
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    log.warn("CUSTOMER_WEBHOOK_BAD_PROTOCOL", {
      protocol: parsed.protocol,
      taskId: payload.task_id,
    });
    return;
  }

  // SSRF defense-in-depth: the URL was checked at POST time via
  // extractCustomerWebhookUrl, but a row inserted before this guard
  // existed (or via direct SQL) could still slip through. Re-check
  // here and drop the delivery if the host is loopback/private/
  // link-local. Customer's POST still got a 200 + task_id; only the
  // notification is suppressed. See lib/api-v1/url-security.ts.
  if (isUnsafeWebhookHost(parsed.hostname)) {
    log.warn("CUSTOMER_WEBHOOK_BLOCKED_HOST", {
      hostname: parsed.hostname,
      taskId: payload.task_id,
      reason: "loopback or private/reserved address — SSRF guard",
    });
    return;
  }

  // Build canonical body string ONCE so the signature signs exactly
  // what's sent. Re-stringifying after sign could re-order keys on
  // some runtimes and break verify.
  const body = JSON.stringify(payload);
  const webhookId = randomUUID();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-webhook-event": event,
    "x-webhook-id": webhookId,
  };

  if (opts.signingSecret) {
    // Stripe-style: timestamp prevents replay; HMAC-SHA256 of
    // "<timestamp>.<body>" prevents tampering. v1= is a version
    // prefix for future rotation.
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", opts.signingSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    headers["x-webhook-signature"] = `t=${timestamp},v1=${sig}`;
  } else {
    log.warn("CUSTOMER_WEBHOOK_UNSIGNED", {
      url,
      event,
      taskId: payload.task_id,
      reason: "no signing secret on linked api_key (legacy)",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
    });
    // Log non-2xx so customer sees their endpoint is broken when they
    // check our logs. Body is intentionally not consumed — we don't
    // care about the response payload, just that the customer's
    // server acknowledged the request.
    if (!res.ok) {
      log.warn("CUSTOMER_WEBHOOK_NON_2XX", {
        url,
        event,
        status: res.status,
        taskId: payload.task_id,
      });
    } else {
      log.info("CUSTOMER_WEBHOOK_DELIVERED", {
        url,
        event,
        status: res.status,
        taskId: payload.task_id,
      });
    }
  } catch (err) {
    // AbortError = timeout; everything else = network failure
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message));
    log.warn(
      isTimeout ? "CUSTOMER_WEBHOOK_TIMEOUT" : "CUSTOMER_WEBHOOK_ERROR",
      {
        url,
        event,
        taskId: payload.task_id,
        ...errFields(err),
      },
    );
  } finally {
    clearTimeout(timer);
  }
}
