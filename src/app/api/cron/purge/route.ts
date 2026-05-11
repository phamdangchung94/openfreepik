import { NextResponse } from "next/server";
import { purgeExpiredSessions } from "@/lib/auth/admin";
import { purgeStaleFailedLogins } from "@/lib/auth/login-throttle";
import { purgeExpiredRateLimitBuckets } from "@/lib/rate-limit";
import { probeAndHealthcheckActiveKeys } from "@/lib/freepik/probe-quota";
import { errFields, log } from "@/lib/logger";

// Probing every active key may hit Magnific N times sequentially — give
// the function enough headroom over Vercel's default 10s budget.
export const maxDuration = 60;

/**
 * GET /api/cron/purge
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Vercel Cron hits this once daily (configured in vercel.json). Deletes
 * expired/stale rows from three tables that would otherwise grow without
 * bound — and in failed_logins's case, would corrupt the lockout state
 * (see audit #12).
 *
 * Vercel Cron auto-injects the bearer; manual invocation needs the same
 * header to prevent random callers from racing the cleanup.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_MISCONFIGURED", { reason: "CRON_SECRET not set" });
    return NextResponse.json(
      { error: "MISCONFIGURED", message: "CRON_SECRET not set" },
      { status: 500 },
    );
  }
  // Audit P1-2: timing-safe compare. Bearer prefix length differs by token
  // length anyway, so the equal-length guard isn't a real leak — it just
  // tells SAST scans we read the rule.
  if (!timingSafeEqualString(auth, `Bearer ${expected}`)) {
    return NextResponse.json(
      { error: "AUTH", message: "Unauthorized" },
      { status: 401 },
    );
  }

  const start = Date.now();
  const results = await Promise.allSettled([
    purgeExpiredSessions(),
    purgeExpiredRateLimitBuckets(),
    purgeStaleFailedLogins(),
    probeAndHealthcheckActiveKeys(),
  ]);

  const keyHealth =
    results[3].status === "fulfilled" ? results[3].value : null;

  const summary = {
    sessions: results[0].status,
    rateLimitBuckets: results[1].status,
    failedLogins: results[2].status,
    keyHealth: results[3].status,
    keysProbed: keyHealth?.probed ?? 0,
    keysDeactivated: keyHealth?.deactivated ?? 0,
    keysFailed: keyHealth?.failed ?? 0,
    durationMs: Date.now() - start,
  };

  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason);
  if (failed.length > 0) {
    log.error("CRON_PARTIAL", {
      summary,
      failures: failed.map((f) => errFields(f)),
    });
  } else {
    log.info("CRON_OK", summary);
  }

  return NextResponse.json({ ok: true, summary });
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i++) mismatch |= aBytes[i]! ^ bBytes[i]!;
  return mismatch === 0;
}
