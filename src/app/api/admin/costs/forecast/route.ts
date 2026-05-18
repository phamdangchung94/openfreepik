import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/costs/forecast
 *
 * Aggregates Freepik upstream EUR burn rate + remaining balance per
 * key, projects days-until-exhaustion based on 7-day moving average.
 *
 * Why only Freepik (not Vercel/Neon/R2): admin uses Vercel Pro tier
 * — function/log quotas are essentially unlimited at current scale.
 * Neon free tier + R2 free egress are also comfortably within budget.
 * The one cost that DOES move with usage and runs out unpredictably
 * is the Freepik account credit.
 *
 * Burn rate calc: sum cost_eur of `succeeded`+`pending` rows per key
 * over last 7 days, divided by 7. `failed`/`refunded` excluded since
 * they're zeroed out (refund returns the EUR to the pool).
 *
 * Days-until-exhaustion: `(assigned - used) / burnRate`. Caps at 999
 * if burn rate is 0 (no usage). Returns 0 if already exhausted.
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // All keys (active + inactive) — admin needs to see inactive ones
  // too for context when planning topups.
  const keys = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      assignedEur: freepikKeys.assignedEur,
      usedEur: freepikKeys.usedEur,
      isActive: freepikKeys.isActive,
      pausedUntil: freepikKeys.pausedUntil,
    })
    .from(freepikKeys);

  // Per-key burn over last 7 days. Only succeeded + pending count —
  // failed/refunded are net-zero for the pool.
  const burn = await db
    .select({
      keyId: usageLogs.keyId,
      totalEur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::text`,
    })
    .from(usageLogs)
    .where(
      and(
        sql`${usageLogs.keyId} IS NOT NULL`,
        sql`${usageLogs.createdAt} > now() - interval '7 days'`,
        sql`${usageLogs.status} IN ('succeeded', 'pending')`,
      ),
    )
    .groupBy(usageLogs.keyId);

  const burnByKey: Record<string, number> = {};
  for (const b of burn) {
    if (b.keyId) burnByKey[b.keyId] = Number(b.totalEur);
  }

  const perKey = keys.map((k) => {
    const assigned = Number(k.assignedEur);
    const used = Number(k.usedEur);
    const remaining = Math.max(assigned - used, 0);
    const burn7d = burnByKey[k.id] ?? 0;
    const dailyBurn = burn7d / 7;
    const daysLeft =
      dailyBurn > 0
        ? Math.max(Math.floor(remaining / dailyBurn), 0)
        : remaining > 0
          ? 999
          : 0;
    const pausedActive = k.pausedUntil
      ? new Date(k.pausedUntil) > new Date()
      : false;
    return {
      id: k.id,
      label: k.label,
      isActive: k.isActive,
      pausedActive,
      assignedEur: assigned,
      usedEur: used,
      remainingEur: remaining,
      burn7dEur: burn7d,
      dailyBurnEur: dailyBurn,
      daysLeft,
      severity: classifySeverity(remaining, dailyBurn),
    };
  });

  // Pool aggregate — sum across active keys only (inactive keys can't
  // serve requests, so their remaining EUR is not "available").
  const activeKeys = perKey.filter((k) => k.isActive);
  const totalRemaining = activeKeys.reduce(
    (sum, k) => sum + k.remainingEur,
    0,
  );
  const totalDailyBurn = activeKeys.reduce(
    (sum, k) => sum + k.dailyBurnEur,
    0,
  );
  const poolDaysLeft =
    totalDailyBurn > 0
      ? Math.max(Math.floor(totalRemaining / totalDailyBurn), 0)
      : totalRemaining > 0
        ? 999
        : 0;

  return NextResponse.json({
    ok: true,
    perKey,
    pool: {
      activeKeyCount: activeKeys.length,
      totalRemainingEur: totalRemaining,
      totalDailyBurnEur: totalDailyBurn,
      daysLeft: poolDaysLeft,
      severity: classifySeverity(totalRemaining, totalDailyBurn),
    },
  });
}

/**
 * Threshold rules — match Phase 1.3 Telegram alert ngưỡng so the UI
 * color-codes consistently with what triggers alerts.
 */
function classifySeverity(
  remainingEur: number,
  dailyBurnEur: number,
): "ok" | "warn" | "critical" {
  if (remainingEur < 30) return "critical";
  if (remainingEur < 100) return "warn";
  // Also warn if burn rate would exhaust within 7 days regardless of
  // absolute amount — useful for power users with high daily turnover.
  if (dailyBurnEur > 0 && remainingEur / dailyBurnEur < 7) return "warn";
  return "ok";
}
