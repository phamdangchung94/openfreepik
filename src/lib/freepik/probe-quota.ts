/**
 * Probe a single API key against Magnific to capture quota / rate-limit
 * response headers. Used by admin dashboard's "Cập nhật" buttons.
 *
 * Reads:
 *   - All `x-*` and `ratelimit-*` headers (case-insensitive) — Magnific
 *     hasn't published canonical names, so we capture broadly and let
 *     admin see what comes back.
 *
 * Endpoint choice: GET /v1/ai/video/kling-v3?per_page=1 — same path the
 * pre-launch sanity check uses. 200/404("Tasks not found") = key valid.
 * 401 = key rejected. We never POST so probing is free (no task created,
 * no credit spent).
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { log } from "@/lib/logger";
import { logAndAlert } from "@/lib/alerts/telegram";

const API_BASE_URL = process.env.FREEPIK_API_BASE_URL ?? "https://api.magnific.com";
const API_KEY_HEADER = process.env.FREEPIK_API_KEY_HEADER ?? "x-magnific-api-key";

const PROBE_PATH = "/v1/ai/video/kling-v3?per_page=1";
// 10s timeout — we don't want a slow Magnific to block the admin UI.
const PROBE_TIMEOUT_MS = 10_000;

export interface QuotaProbeResult {
  ok: boolean;
  status: number;
  /** Captured response headers — keys lowercased; only x-* and ratelimit-*. */
  headers: Record<string, string>;
  /** First 200 chars of body for debugging when status != 200. */
  bodySnippet: string;
  elapsedMs: number;
  /** Set when fetch threw (DNS, timeout, etc.). */
  errorMessage?: string;
}

export async function probeKeyQuota(encryptedKey: string): Promise<QuotaProbeResult> {
  const start = Date.now();
  let plaintext: string;
  try {
    plaintext = await decrypt(encryptedKey);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: {},
      bodySnippet: "",
      elapsedMs: Date.now() - start,
      errorMessage: `decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let res: Response;
  try {
    res = await fetch(API_BASE_URL + PROBE_PATH, {
      method: "GET",
      headers: { [API_KEY_HEADER]: plaintext },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: {},
      bodySnippet: "",
      elapsedMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  // Capture all x-* / ratelimit-* / quota-* headers — exact names unknown.
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      lower.startsWith("x-") ||
      lower.startsWith("ratelimit-") ||
      lower.includes("quota") ||
      lower.includes("limit") ||
      lower.includes("credit")
    ) {
      headers[lower] = value;
    }
  });

  const bodyText = await res.text().catch(() => "");
  // 200 = list returned, 404 with "Tasks not found" = auth OK, no tasks.
  // Both prove the key works.
  const authOk =
    res.status === 200 ||
    (res.status === 404 && bodyText.includes("Tasks not found"));

  return {
    ok: authOk,
    status: res.status,
    headers,
    bodySnippet: bodyText.slice(0, 200).replace(/\s+/g, " "),
    elapsedMs: Date.now() - start,
  };
}

/**
 * Latency threshold — if probe takes longer than this AND it's
 * succeeded (no error), we still flag the key as "slow" via Telegram.
 * Magnific p50 is ~200-500ms; >5s sustained = something upstream
 * (or the key's account-level rate limiting) is degrading.
 */
const SLOW_PROBE_THRESHOLD_MS = 5000;

/**
 * Cron-friendly health check: probe every active key, surface results
 * in logs, and auto-deactivate / auto-pause keys based on probe outcome.
 *
 * Detection rules:
 *   - 401/403 → auto-deactivate (`isActive=false`), Telegram critical
 *     alert. Magnific has revoked the key; no recovery without admin
 *     re-issuing.
 *   - 429    → auto-pause for 1h (set `pausedUntil = now + 1h`), warn
 *     alert. Key is rate-limited at the account level; `pickActiveKey`
 *     skips it during the window, comes back online after.
 *   - ok but elapsedMs > 5s → log + warn alert (no state change). Key
 *     is slow; admin should check upstream status page.
 *   - 5xx / network / timeout → log only (transient — could be Magnific).
 *
 * Does NOT touch `used_eur` — Magnific doesn't publish a single
 * canonical "remaining credit" header today, so we'd be guessing. The
 * server-side accounting (`recordKeyCost`) remains source of truth.
 */
export async function probeAndHealthcheckActiveKeys(): Promise<{
  probed: number;
  deactivated: number;
  paused: number;
  slow: number;
  failed: number;
}> {
  const keys = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      keyEncrypted: freepikKeys.keyEncrypted,
    })
    .from(freepikKeys)
    .where(eq(freepikKeys.isActive, true));

  let deactivated = 0;
  let paused = 0;
  let slow = 0;
  let failed = 0;

  await Promise.all(
    keys.map(async (k) => {
      const probe = await probeKeyQuota(k.keyEncrypted);

      if (probe.ok) {
        // OK but slow — surface but don't change state.
        if (probe.elapsedMs > SLOW_PROBE_THRESHOLD_MS) {
          logAndAlert({
            severity: "warn",
            event: "KEY_SLOW",
            title: `Key "${k.label}" probe chậm`,
            body: `Latency ${probe.elapsedMs}ms (ngưỡng ${SLOW_PROBE_THRESHOLD_MS}ms)`,
            fields: { keyId: k.id, elapsedMs: probe.elapsedMs },
          });
          slow++;
        }
        return;
      }

      if (probe.status === 401 || probe.status === 403) {
        // Magnific revoked the key — auto-deactivate to stop the
        // orchestrator burning retries on it. Admin sees the alert
        // and can investigate.
        await db
          .update(freepikKeys)
          .set({ isActive: false })
          .where(eq(freepikKeys.id, k.id));
        logAndAlert({
          severity: "critical",
          event: "KEY_AUTO_DEACTIVATED",
          title: `Key "${k.label}" auto-deactivate`,
          body: `Probe trả về ${probe.status} — Magnific đã revoke key, cần admin xử lý`,
          fields: { keyId: k.id, status: probe.status, reason: "PROBE_UNAUTHORIZED" },
        });
        deactivated++;
        return;
      }

      if (probe.status === 429) {
        // Rate-limited at the account level — pause for 1h so
        // pickActiveKey skips it. Auto-recovers after window.
        const pausedUntil = new Date(Date.now() + 60 * 60_000);
        await db
          .update(freepikKeys)
          .set({ pausedUntil })
          .where(eq(freepikKeys.id, k.id));
        logAndAlert({
          severity: "warn",
          event: "KEY_AUTO_PAUSED",
          title: `Key "${k.label}" paused 1 giờ (rate limit)`,
          body: `Probe trả về 429 — pickActiveKey skip cho đến ${pausedUntil.toISOString()}`,
          fields: { keyId: k.id, pausedUntil: pausedUntil.toISOString() },
        });
        paused++;
        return;
      }

      // Network / timeout / other 4xx-5xx — flag for admin attention
      // but don't auto-deactivate (could be transient Magnific issue).
      log.warn("KEY_PROBE_FAILED", {
        keyId: k.id,
        label: k.label,
        status: probe.status,
        elapsedMs: probe.elapsedMs,
        errorMessage: probe.errorMessage?.slice(0, 200),
      });
      failed++;
    }),
  );

  return { probed: keys.length, deactivated, paused, slow, failed };
}
