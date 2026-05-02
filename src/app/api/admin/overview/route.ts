import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activationCodes,
  freepikKeys,
  usageLogs,
} from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/overview — single roll-up endpoint for the dashboard
 * landing page. Avoids 5 separate fetches from the client.
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const [codeRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) FILTER (WHERE ${activationCodes.isActive})::int`,
      totalUsedEur: sql<string>`COALESCE(SUM(${activationCodes.usedEur}), 0)::numeric`,
    })
    .from(activationCodes);

  const [keyRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) FILTER (WHERE ${freepikKeys.isActive})::int`,
      totalAssignedEur: sql<string>`COALESCE(SUM(${freepikKeys.assignedEur}), 0)::numeric`,
      totalUsedEur: sql<string>`COALESCE(SUM(${freepikKeys.usedEur}), 0)::numeric`,
    })
    .from(freepikKeys);

  const [usage7d] = await db
    .select({
      videos: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::numeric`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.status, "succeeded"),
        gte(usageLogs.createdAt, sql`now() - interval '7 days'`),
      ),
    );

  const [usageToday] = await db
    .select({
      videos: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::numeric`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.status, "succeeded"),
        gte(usageLogs.createdAt, sql`date_trunc('day', now())`),
      ),
    );

  return NextResponse.json({
    ok: true,
    codes: {
      total: codeRow?.total ?? 0,
      active: codeRow?.active ?? 0,
      totalUsedEur: Number(codeRow?.totalUsedEur ?? 0),
    },
    keys: {
      total: keyRow?.total ?? 0,
      active: keyRow?.active ?? 0,
      totalAssignedEur: Number(keyRow?.totalAssignedEur ?? 0),
      totalUsedEur: Number(keyRow?.totalUsedEur ?? 0),
      remainingEur:
        Number(keyRow?.totalAssignedEur ?? 0) -
        Number(keyRow?.totalUsedEur ?? 0),
    },
    usage7d: {
      videos: usage7d?.videos ?? 0,
      eur: Number(usage7d?.eur ?? 0),
    },
    usageToday: {
      videos: usageToday?.videos ?? 0,
      eur: Number(usageToday?.eur ?? 0),
    },
  });
}
