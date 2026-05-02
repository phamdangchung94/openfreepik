import { NextResponse } from "next/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { extractActivationCode } from "@/lib/freepik/route-helpers";
import { validateCode } from "@/lib/auth/activation";

/**
 * GET /api/usage
 * Header: Authorization: Bearer <activation-code>
 *
 * Returns the customer's own usage stats — balance, totals, today's
 * activity, and the 20 most recent log rows. Customers see only their
 * own code's data; the admin dashboard (Phase 10) shows all codes.
 */
export async function GET(request: Request) {
  const code = extractActivationCode(request);
  const validation = await validateCode(code ?? "");
  if (!validation.ok) {
    return NextResponse.json(
      { error: "AUTH", message: "Activation required." },
      { status: 401 },
    );
  }

  const { codeId, mode, quotaEur, usedEur, remainingEur, label } =
    validation.metadata;

  // Aggregate succeeded usage in two windows.
  const [totalsRow] = await db
    .select({
      videos: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::numeric`,
    })
    .from(usageLogs)
    .where(
      and(eq(usageLogs.codeId, codeId), eq(usageLogs.status, "succeeded")),
    );

  const [todayRow] = await db
    .select({
      videos: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::numeric`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.codeId, codeId),
        eq(usageLogs.status, "succeeded"),
        gte(usageLogs.createdAt, sql`date_trunc('day', now())`),
      ),
    );

  const recent = await db
    .select({
      id: usageLogs.id,
      createdAt: usageLogs.createdAt,
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      freepikTaskId: usageLogs.freepikTaskId,
      status: usageLogs.status,
    })
    .from(usageLogs)
    .where(eq(usageLogs.codeId, codeId))
    .orderBy(desc(usageLogs.createdAt))
    .limit(20);

  return NextResponse.json({
    balance: { mode, label, quotaEur, usedEur, remainingEur },
    totals: {
      videos: totalsRow?.videos ?? 0,
      eur: Number(totalsRow?.eur ?? 0),
    },
    today: {
      videos: todayRow?.videos ?? 0,
      eur: Number(todayRow?.eur ?? 0),
    },
    recent: recent.map((r) => ({
      ...r,
      costEur: Number(r.costEur),
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
