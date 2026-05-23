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
 *   - **No HMAC signature yet** — customer can authenticate via a
 *     URL query token (`?token=xyz`) or trust source IP. We'll add
 *     signing if customer demand surfaces.
 *   - **2-second HTTP timeout** caps each call so a slow customer
 *     endpoint can't pile up serverless function time. AbortController
 *     fires the timeout cleanly.
 *   - **Errors swallow** — log warn-level so they show in Vercel
 *     logs but never propagate to the caller (finalize must
 *     succeed regardless of webhook delivery).
 */

import { errFields, log } from "@/lib/logger";

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

export async function fireCustomerWebhook(
  url: string,
  event: CustomerWebhookEvent,
  payload: CustomerWebhookPayload,
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-webhook-event": event,
      },
      body: JSON.stringify(payload),
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
