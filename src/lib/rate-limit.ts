/**
 * DB-backed fixed-window rate limiter.
 *
 * Trade-off vs Vercel KV / Upstash: ~50ms per check (Neon HTTP roundtrip)
 * but no new vendor and zero ops setup. Migrating to KV later is a
 * targeted swap inside this file.
 *
 * Bucket key shape: `<resource>:<scope>:<minuteBucket>` so each window
 * gets its own row and old buckets just expire (not modified).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimitBuckets } from "@/lib/db/schema";

export interface RateLimitOptions {
  /** Logical name of the limited resource — e.g. "kling-v3", "activate". */
  resource: string;
  /** Per-caller scope, e.g. activation code id or IP. */
  scope: string;
  /** Max requests allowed inside `windowSeconds`. */
  limit: number;
  /** Window length. Use 60 for "per minute", 3600 for "per hour". */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Current count inside the active window after this request. */
  count: number;
  /** Configured cap (echoed back for `X-RateLimit-Limit` header). */
  limit: number;
  /** Estimated requests left in window (limit - count, floored 0). */
  remaining: number;
  /** Seconds until the active window resets (Retry-After header). */
  retryAfterSeconds: number;
}

/**
 * Atomic check-and-increment. Returns allowed=false when the bucket has
 * already exceeded `limit`; the caller should respond 429 with the
 * returned `retryAfterSeconds`.
 *
 * Implementation notes:
 *   - We INSERT … ON CONFLICT DO UPDATE so the SELECT+INSERT is one
 *     atomic statement. Postgres serializes concurrent UPSERTs on the
 *     same primary key.
 *   - We compute the bucket label (epoch / windowSeconds) so different
 *     windows don't collide and stale rows are naturally orphaned.
 */
export async function checkRateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowIdx = Math.floor(nowSec / opts.windowSeconds);
  const bucketKey = `${opts.resource}:${opts.scope}:${windowIdx}`;
  const expiresAt = new Date((windowIdx + 1) * opts.windowSeconds * 1000);

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ bucketKey, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: rateLimitBuckets.bucketKey,
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });

  const count = row?.count ?? 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(expiresAt.getTime() / 1000 - nowSec),
  );

  return {
    allowed: count <= opts.limit,
    count,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfterSeconds,
  };
}

/**
 * Best-effort cleanup of expired buckets. Safe to call from a cron or
 * to ignore entirely — stale rows aren't referenced by any live code.
 */
export async function purgeExpiredRateLimitBuckets(): Promise<void> {
  await db
    .delete(rateLimitBuckets)
    .where(sql`${rateLimitBuckets.expiresAt} < now()`);
}
