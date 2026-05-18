import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/keys/[id]/health
 *
 * Returns health snapshot for a single Freepik key:
 *   - Key metadata (label, isActive, pausedUntil, assigned/used EUR,
 *     maxConcurrent)
 *   - 30-day aggregate (total tasks, succeeded, failed, refunded)
 *   - Daily series (date, tasks, eur, failure rate) for sparkline
 *   - In-flight count (active tasks in last 5min, matches pickActiveKey)
 *   - Last 10 errors (verbatim error_message + endpoint + when)
 *
 * Read-only; doesn't probe upstream. Admin uses "Cập nhật" button on
 * the main /keys page for fresh upstream probe (existing flow).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;

  const [key] = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      assignedEur: freepikKeys.assignedEur,
      usedEur: freepikKeys.usedEur,
      isActive: freepikKeys.isActive,
      pausedUntil: freepikKeys.pausedUntil,
      maxConcurrent: freepikKeys.maxConcurrent,
      notes: freepikKeys.notes,
      createdAt: freepikKeys.createdAt,
      lastUsedAt: freepikKeys.lastUsedAt,
    })
    .from(freepikKeys)
    .where(eq(freepikKeys.id, id))
    .limit(1);

  if (!key) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Key not found." },
      { status: 404 },
    );
  }

  // 30-day aggregate by status — single query
  const aggregate = await db
    .select({
      status: usageLogs.status,
      count: sql<number>`count(*)::int`,
      totalEur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::text`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.keyId, id),
        sql`${usageLogs.createdAt} > now() - interval '30 days'`,
      ),
    )
    .groupBy(usageLogs.status);

  // Daily series 30 days
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageLogs.createdAt}), 'YYYY-MM-DD')`,
      tasks: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::text`,
      failures: sql<number>`SUM(CASE WHEN ${usageLogs.status} IN ('failed', 'refunded') THEN 1 ELSE 0 END)::int`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.keyId, id),
        sql`${usageLogs.createdAt} > now() - interval '30 days'`,
      ),
    )
    .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
    .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`);

  // In-flight count — matches pickActiveKey's definition (succeeded
  // status, no video_url yet, last 5 min). Tells admin if the key is
  // saturated near max_concurrent.
  const [inflight] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.keyId, id),
        eq(usageLogs.status, "succeeded"),
        sql`${usageLogs.videoUrl} IS NULL`,
        sql`${usageLogs.createdAt} > now() - interval '5 minutes'`,
      ),
    );

  // Last 10 errors — verbatim error_message, with endpoint + time
  const recentErrors = await db
    .select({
      id: usageLogs.id,
      createdAt: usageLogs.createdAt,
      endpoint: usageLogs.endpoint,
      status: usageLogs.status,
      errorMessage: usageLogs.errorMessage,
      freepikTaskId: usageLogs.freepikTaskId,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.keyId, id),
        sql`${usageLogs.status} IN ('failed', 'refunded')`,
        sql`${usageLogs.errorMessage} IS NOT NULL`,
      ),
    )
    .orderBy(desc(usageLogs.createdAt))
    .limit(10);

  return NextResponse.json({
    ok: true,
    key,
    aggregate,
    daily,
    inflight: inflight?.count ?? 0,
    recentErrors,
  });
}
