/**
 * Per-IP brute-force protection for the admin login endpoint.
 *
 * Lock for 15 minutes after 5 failures inside any 15-minute rolling
 * window. Successful login or `locked_until < now()` resets the counter.
 *
 * Distinct from src/lib/rate-limit.ts because the semantics are different:
 *   - Rate limit: count per fixed window, allow N inside window.
 *   - Login throttle: cumulative failure counter that flips a "locked"
 *     state and stays locked until the timeout passes.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { failedLogins } from "@/lib/db/schema";

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const COUNTER_RESET_MINUTES = 15;

export interface LoginThrottleStatus {
  locked: boolean;
  retryAfterSeconds: number;
  attemptsRemaining: number;
}

/**
 * Check if the IP can attempt a login right now. Call BEFORE comparing
 * the password — we want every check (success or failure) to go through
 * this gate so admin sees consistent rate limiting behavior.
 */
export async function checkLoginAllowed(
  ip: string,
): Promise<LoginThrottleStatus> {
  if (!ip) {
    // No IP captured (proxy misconfiguration?) — fail safe and allow,
    // but the caller should log this case for review.
    return { locked: false, retryAfterSeconds: 0, attemptsRemaining: MAX_FAILURES };
  }

  const [row] = await db
    .select()
    .from(failedLogins)
    .where(eq(failedLogins.ip, ip))
    .limit(1);

  const now = Date.now();

  // Drizzle's neon-http driver returns timestamptz as ISO strings, not
  // Date — calling .getTime() on a string throws TypeError. Normalise
  // both shapes to ms before comparing.
  const lockedUntilMs = tsToMs(row?.lockedUntil ?? null);
  const lastAttemptMs = tsToMs(row?.lastAttempt ?? null);

  // Currently locked?
  if (lockedUntilMs !== null && lockedUntilMs > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((lockedUntilMs - now) / 1000),
      attemptsRemaining: 0,
    };
  }

  // Counter reset window has passed?
  if (
    row &&
    lastAttemptMs !== null &&
    lastAttemptMs < now - COUNTER_RESET_MINUTES * 60_000
  ) {
    return {
      locked: false,
      retryAfterSeconds: 0,
      attemptsRemaining: MAX_FAILURES,
    };
  }

  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: Math.max(0, MAX_FAILURES - (row?.attempts ?? 0)),
  };
}

/**
 * Record a failed login attempt. Returns the updated status — when
 * attempts hit MAX_FAILURES, locks the IP for LOCKOUT_MINUTES.
 */
export async function recordFailedLogin(
  ip: string,
): Promise<LoginThrottleStatus> {
  if (!ip) {
    return { locked: false, retryAfterSeconds: 0, attemptsRemaining: MAX_FAILURES };
  }

  const lockoutMs = LOCKOUT_MINUTES * 60_000;

  // UPSERT — atomic increment + conditional lock-set in one statement.
  //
  // Subtlety: when the previous attempt was longer than COUNTER_RESET_MINUTES
  // ago, the counter resets to 1 (not increments). Without this, an IP that
  // failed 4 times an hour ago would lock out on its very next wrong
  // password — even though `checkLoginAllowed` already told the user
  // "5 attempts remaining". This keeps both functions consistent without
  // a separate reset DB roundtrip.
  const [row] = await db
    .insert(failedLogins)
    .values({
      ip,
      attempts: 1,
      lastAttempt: new Date(),
      lockedUntil: null,
    })
    .onConflictDoUpdate({
      target: failedLogins.ip,
      set: {
        // Audit P2-5: dropped sql.raw — multiply a parameterised
        // numeric literal by an interval instead. Same plan, no
        // false-positive in SAST scans.
        attempts: sql`CASE
          WHEN ${failedLogins.lastAttempt} < now() - (${COUNTER_RESET_MINUTES}::int * interval '1 minute')
          THEN 1
          ELSE ${failedLogins.attempts} + 1
        END`,
        lastAttempt: sql`now()`,
        lockedUntil: sql`CASE
          WHEN ${failedLogins.lastAttempt} < now() - (${COUNTER_RESET_MINUTES}::int * interval '1 minute')
          THEN NULL
          WHEN ${failedLogins.attempts} + 1 >= ${MAX_FAILURES}
          THEN now() + (${LOCKOUT_MINUTES}::int * interval '1 minute')
          ELSE ${failedLogins.lockedUntil}
        END`,
      },
    })
    .returning();

  if (!row) {
    return { locked: false, retryAfterSeconds: 0, attemptsRemaining: MAX_FAILURES };
  }

  if (row.attempts >= MAX_FAILURES) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil(lockoutMs / 1000),
      attemptsRemaining: 0,
    };
  }
  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: Math.max(0, MAX_FAILURES - row.attempts),
  };
}

/** Reset counter on successful login. */
export async function clearFailedLogins(ip: string): Promise<void> {
  if (!ip) return;
  await db.delete(failedLogins).where(eq(failedLogins.ip, ip));
}

/**
 * Periodic cleanup — delete any row whose last attempt is more than 24h
 * old, regardless of lock state. Stale `attempts` values are now also
 * handled at write time by recordFailedLogin's CASE expression (counter
 * resets to 1 when the previous attempt is older than COUNTER_RESET_MINUTES),
 * but this keeps the table from growing forever.
 */
export async function purgeStaleFailedLogins(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(failedLogins)
    .where(sql`${failedLogins.lastAttempt} < ${cutoff}`);
}

/**
 * Re-export so existing call-sites (admin login route) keep working.
 * Real implementation lives in `src/lib/request-ip.ts` so it's reusable
 * by rate-limit middleware without dragging in the throttle DB layer.
 */
export { getClientIp } from "@/lib/request-ip";

/**
 * Coerce a Drizzle timestamp (Date from node-postgres OR ISO string from
 * neon-http) to epoch ms, or null if absent / unparseable.
 */
function tsToMs(v: Date | string | null): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}
