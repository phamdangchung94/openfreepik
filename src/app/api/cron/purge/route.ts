import { NextResponse } from "next/server";
import { purgeExpiredSessions } from "@/lib/auth/admin";
import { purgeStaleFailedLogins } from "@/lib/auth/login-throttle";
import { purgeExpiredRateLimitBuckets } from "@/lib/rate-limit";

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
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/purge] CRON_SECRET env var is not set");
    return NextResponse.json(
      { error: "MISCONFIGURED", message: "CRON_SECRET not set" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
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
  ]);

  const summary = {
    sessions: results[0].status,
    rateLimitBuckets: results[1].status,
    failedLogins: results[2].status,
    durationMs: Date.now() - start,
  };

  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => (r as PromiseRejectedResult).reason);
  if (failed.length > 0) {
    console.error("[cron/purge] one or more purges failed:", failed);
  }

  return NextResponse.json({ ok: true, summary });
}
