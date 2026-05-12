/** Shared helpers for Next.js API route handlers. */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authedFreepikCall } from "./orchestrator";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { errFields, log } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";

/**
 * DRY helper: validate the bearer once, gate by per-code rate limit,
 * then run the handler with the validation result so the orchestrator
 * doesn't double-fetch from the DB.
 *
 * Audit P2-10: lifted out of /api/freepik/kling-v3 and improve-prompt
 * which had near-identical bodies.
 *
 * Returns:
 *   - 401 if no bearer or validation fails
 *   - 429 if the per-code rate limit fires
 *   - whatever the handler returns otherwise (passes through)
 */
export interface RateLimitedCodeOpts {
  resource: string;
  limit: number;
  windowSeconds: number;
}

export async function withRateLimitedCode(
  request: Request,
  opts: RateLimitedCodeOpts,
  handler: (
    bearer: string,
    validation: ValidationResult & { ok: true },
  ) => Promise<Response>,
): Promise<Response> {
  const bearer = extractActivationCode(request);
  if (!bearer) {
    return NextResponse.json(
      { error: "AUTH", message: "Activation code is required." },
      { status: 401 },
    );
  }

  const validation = await validateCode(bearer);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.reason.toUpperCase(),
        message: "Auth failed.",
      },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit({
    resource: opts.resource,
    scope: validation.metadata.codeId,
    limit: opts.limit,
    windowSeconds: opts.windowSeconds,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMIT",
        message: `Limit ${opts.limit} requests per ${opts.windowSeconds}s. Wait ${rl.retryAfterSeconds}s and retry.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  return handler(bearer, validation);
}

/**
 * Parse JSON body from a NextRequest, returning null on failure.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Extract a bearer-token activation code from the Authorization header.
 * Accepts: `Authorization: Bearer <code>` (case-insensitive scheme).
 * Returns null if missing or malformed.
 */
/**
 * Minimum bearer length we accept. Activation codes are issued at 32+
 * chars; anything shorter is either a typo or a probe and we'd rather
 * surface a clean 401 than do a DB roundtrip. Keeps bearer-length
 * logic in one place (audit P2-9).
 */
export const MIN_BEARER_LENGTH = 8;

export function extractActivationCode(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const code = match?.[1]?.trim();
  if (!code || code.length < MIN_BEARER_LENGTH) return null;
  return code;
}

interface TaskGetHandlerOptions<T> {
  /**
   * Best-effort side effect after a successful poll — used by kling-v3 to
   * write the video URL into usage_logs once Freepik reports COMPLETED.
   * Errors are swallowed: the customer's poll succeeds either way.
   */
  onSuccess?: (taskId: string, data: T) => Promise<void> | void;
  /**
   * Per-code rate limit applied BEFORE picking a Freepik key. Polls fire
   * every couple seconds so this should be generous (e.g. 60/min) — the
   * point is to cap a stuck client looping at 50 req/s, not gate normal
   * polling.
   */
  rateLimit?: {
    resource: string;
    limit: number;
    windowSeconds: number;
  };
}

/**
 * Build a GET handler for `/[taskId]` routes that polls Freepik task status.
 * Uses authedFreepikCall — validates the activation code and picks a key
 * from the pool, but doesn't charge or log (poll fires every few seconds).
 */
export function createTaskGetHandler<T>(
  getter: (taskId: string, opts: { apiKey: string }) => Promise<T>,
  options?: TaskGetHandlerOptions<T>,
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ taskId: string }> },
  ) {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "taskId is required." },
        { status: 400 },
      );
    }

    // Optional pre-flight: validate once to get codeId, then enforce a
    // per-code rate limit. Pass the validation through so authedFreepikCall
    // doesn't re-fetch.
    const bearer = extractActivationCode(request);
    let validation: ValidationResult | undefined;
    if (options?.rateLimit && bearer) {
      validation = await validateCode(bearer);
      if (validation.ok) {
        const rl = await checkRateLimit({
          resource: options.rateLimit.resource,
          scope: validation.metadata.codeId,
          limit: options.rateLimit.limit,
          windowSeconds: options.rateLimit.windowSeconds,
        });
        if (!rl.allowed) {
          return NextResponse.json(
            {
              error: "RATE_LIMIT",
              message: `Polling too fast — wait ${rl.retryAfterSeconds}s.`,
            },
            {
              status: 429,
              headers: { "retry-after": String(rl.retryAfterSeconds) },
            },
          );
        }
      }
    }

    // Find the pool key that originally created this task so polling
    // hits the same upstream account. Magnific scopes task visibility
    // to the account that POST'd the create call — picking an LRU
    // key here causes ~75% of polls to land on accounts that can't
    // see this task and return 404 (audit 2026-05-12 saw the
    // 200/404 alternation on every customer task). Migration 0008
    // added a partial index on (freepik_task_id) so this lookup is
    // a constant-time hit even with 10k+ usage_log rows.
    let preferredKeyId: string | null = null;
    try {
      const [row] = await db
        .select({ keyId: usageLogs.keyId })
        .from(usageLogs)
        .where(eq(usageLogs.freepikTaskId, taskId))
        .limit(1);
      if (row?.keyId) preferredKeyId = row.keyId;
    } catch (err) {
      log.warn("POLL_KEY_LOOKUP_FAILED", { taskId, ...errFields(err) });
    }

    const result = await authedFreepikCall({
      bearerCode: bearer,
      preValidated: validation,
      preferredKeyId,
      callFreepik: (apiKey) => getter(taskId, { apiKey }),
    });

    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    if (options?.onSuccess) {
      try {
        await options.onSuccess(taskId, result.data);
      } catch (err) {
        log.warn("POLL_ONSUCCESS_FAILED", { taskId, ...errFields(err) });
      }
    }

    return NextResponse.json({ data: result.data });
  };
}
