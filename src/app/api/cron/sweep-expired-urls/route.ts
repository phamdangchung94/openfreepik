import { NextResponse } from "next/server";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { log } from "@/lib/logger";

/**
 * Cron: GET /api/cron/sweep-expired-urls (every 6h)
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Clears `usage_logs.video_url` to NULL for any row whose
 * `video_url_expires_at` is in the past. The R2 lifecycle has already
 * deleted the actual object at 24h, so the URL is dead — leaving it
 * in the DB means history hydration (use-history-hydration.ts) keeps
 * re-pushing the dead URL into the customer's local task store on
 * every page load, showing a broken `<video>` element.
 *
 * Keeps `magnific_video_url` untouched (permanent record per audit;
 * admin can still see what was generated). Only the customer-facing
 * R2 mirror URL gets nulled.
 *
 * Idempotent — running twice in a row makes no extra changes. Cheap
 * single UPDATE. Bound to status='succeeded' so we don't touch failed/
 * refunded rows (they shouldn't have a video_url anyway, but defensive).
 *
 * Why every 6h:
 *   - URL is dead-but-listed for at most 6h after R2 deletion
 *   - Daily would leave URLs broken for up to 24h, ugly UX
 *   - Hourly is overkill — UPDATE scans usage_logs every time
 */

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_MISCONFIGURED", {
      cron: "sweep-expired-urls",
      reason: "CRON_SECRET not set",
    });
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

  // Set video_url=NULL where the URL has passed its expiry. Single
  // statement; partial-index on (status, video_url_expires_at) would
  // help if usage_logs grows past 1M rows, but at current volume the
  // status_created_at index is enough for the planner.
  const updated = await db
    .update(usageLogs)
    .set({
      videoUrl: null,
      // Also drop the expiry timestamp — once URL is null there's
      // nothing for it to time against.
      videoUrlExpiresAt: null,
    })
    .where(
      and(
        eq(usageLogs.status, "succeeded"),
        isNotNull(usageLogs.videoUrl),
        isNotNull(usageLogs.videoUrlExpiresAt),
        lt(usageLogs.videoUrlExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: usageLogs.id });

  log.info("EXPIRED_URLS_SWEPT", { cleared: updated.length });

  return NextResponse.json({
    ok: true,
    cleared: updated.length,
    note:
      updated.length === 0
        ? "Không có URL expired nào — DB đã clean"
        : `Cleared ${updated.length} dead R2 URLs từ usage_logs`,
  });
}
