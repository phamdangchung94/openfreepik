import { NextResponse } from "next/server";
import type { RateLimitResult } from "@/lib/rate-limit";

/**
 * Standardized response helpers for /api/v1/* endpoints.
 *
 * Two improvements over hand-rolled NextResponse.json:
 *   1. Every error includes `request_id` — when customer reports a
 *      problem, they paste the id, admin greps logs by request_id and
 *      finds the exact request. Without it, support tickets devolve
 *      into "what time did this happen?".
 *   2. Standard rate-limit headers (X-RateLimit-*) attached when a
 *      RateLimitResult is provided — customers can self-throttle
 *      without hitting 429s.
 */

export interface ApiErrorOpts {
  status: number;
  error: string;
  message: string;
  requestId: string;
  /** Attach X-RateLimit-* headers when the request was rate-limited. */
  rateLimit?: RateLimitResult;
  /** Extra headers (e.g. retry-after on 429). */
  headers?: Record<string, string>;
  /** Extra error fields (e.g. zod issues). */
  extra?: Record<string, unknown>;
}

export interface ApiSuccessOpts<T> {
  status?: number;
  data: T;
  requestId: string;
  /** Attach X-RateLimit-* headers when the request was rate-limited. */
  rateLimit?: RateLimitResult;
  /** Extra headers. */
  headers?: Record<string, string>;
}

/**
 * Build a JSON error response with `{ ok: false, error, message,
 * request_id }` shape. Attaches request_id + rate-limit headers.
 */
export function apiError(opts: ApiErrorOpts): NextResponse {
  const headers = {
    "x-request-id": opts.requestId,
    ...rateLimitHeaders(opts.rateLimit),
    ...(opts.headers ?? {}),
  };
  return NextResponse.json(
    {
      ok: false,
      error: opts.error,
      message: opts.message,
      request_id: opts.requestId,
      ...(opts.extra ?? {}),
    },
    { status: opts.status, headers },
  );
}

/**
 * Build a JSON success response. Attaches request_id header (NOT in
 * body — body shape is endpoint-specific) + rate-limit headers.
 */
export function apiSuccess<T>(opts: ApiSuccessOpts<T>): NextResponse {
  const headers = {
    "x-request-id": opts.requestId,
    ...rateLimitHeaders(opts.rateLimit),
    ...(opts.headers ?? {}),
  };
  return NextResponse.json(opts.data, {
    status: opts.status ?? 200,
    headers,
  });
}

/**
 * Extract the optional `webhook_url` field from a parsed request body
 * and validate it as a URL. Returns null if absent or invalid (silent
 * — invalid webhook is non-fatal; customer can still poll). Used by
 * v1 video POST routes to capture the customer's notification endpoint
 * for later forwarding by finalizeUsageOnPoll.
 *
 * Accepts http/https only — file:// or javascript: URLs would let an
 * attacker make the server POST sensitive payloads to its own loopback
 * or trigger redirector flows.
 */
export function extractCustomerWebhookUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).webhook_url;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Generate `X-RateLimit-Limit / Remaining / Reset` headers from a
 * checkRateLimit result. Customer-facing convention follows
 * draft-ietf-httpapi-ratelimit-headers — Remaining = limit - count,
 * Reset = seconds until the window expires.
 *
 * The original `checkRateLimit` returns `{allowed, count, retryAfterSeconds}`
 * without the limit value — callers pass it in. Helper signature
 * lets routes do `rateLimitHeaders(rl, limit)` once.
 */
function rateLimitHeaders(
  rl: RateLimitResult | undefined,
): Record<string, string> {
  if (!rl) return {};
  return {
    "x-ratelimit-remaining": String(Math.max(0, rl.remaining)),
    "x-ratelimit-limit": String(rl.limit),
    "x-ratelimit-reset": String(rl.retryAfterSeconds),
  };
}

/**
 * Wrap an unknown request body with a fresh request_id. Use this at
 * the very top of every /v1/* handler. The id propagates through all
 * downstream logs (orchestrator's own requestId currently differs —
 * matched separately by codeId+timestamp).
 *
 * Returns a stable UUID v4. No external dependencies.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
