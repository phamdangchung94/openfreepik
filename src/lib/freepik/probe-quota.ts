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

import { decrypt } from "@/lib/crypto/aes-gcm";

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
