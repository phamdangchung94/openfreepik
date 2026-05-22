import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, vouchers } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/vouchers
 *
 * Query params:
 *   - tier: "100k" | "200k" | "500k" (optional filter)
 *   - status: "available" | "redeemed" | "revoked" | "refunded" (optional)
 *   - batchLabel: string (optional)
 *   - limit: 1..500 (default 100)
 *   - offset: int (default 0)
 *
 * Response:
 *   {
 *     ok: true,
 *     vouchers: [{ id, code, tier, vndValue, eurValue, batchLabel,
 *                  createdAt, status, redeemedAt, redeemedByCodeLabel, ... }],
 *     stats: { total, available, redeemed, revoked, refunded,
 *              totalVndIssued, totalEurCredited }
 *   }
 *
 * Stats are computed on the FULL voucher table (not filtered) so the
 * dashboard top-card shows true totals regardless of filter selection.
 */

export async function GET(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(request.url);
  const tier = url.searchParams.get("tier");
  const status = url.searchParams.get("status");
  const batchLabel = url.searchParams.get("batchLabel");
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "100")),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));

  // Build WHERE clause from filters
  const conditions = [];
  if (tier && ["100k", "200k", "500k"].includes(tier)) {
    conditions.push(eq(vouchers.tier, tier as "100k" | "200k" | "500k"));
  }
  if (batchLabel) {
    conditions.push(eq(vouchers.batchLabel, batchLabel));
  }
  if (status === "available") {
    conditions.push(isNull(vouchers.redeemedAt));
    conditions.push(isNull(vouchers.revokedAt));
  } else if (status === "redeemed") {
    conditions.push(isNotNull(vouchers.redeemedAt));
    conditions.push(isNull(vouchers.refundedAt));
  } else if (status === "revoked") {
    conditions.push(isNotNull(vouchers.revokedAt));
  } else if (status === "refunded") {
    conditions.push(isNotNull(vouchers.refundedAt));
  }

  // Join redeemed activation code label for display (left join — keeps
  // unredeemed rows). Drizzle's syntax sugar for left-join below.
  const rowsQuery = db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      tier: vouchers.tier,
      vndValue: vouchers.vndValue,
      eurValue: vouchers.eurValue,
      batchLabel: vouchers.batchLabel,
      createdAt: vouchers.createdAt,
      revokedAt: vouchers.revokedAt,
      revokeReason: vouchers.revokeReason,
      redeemedAt: vouchers.redeemedAt,
      redeemedByCodeId: vouchers.redeemedByCodeId,
      redeemedByCodeLabel: activationCodes.customerLabel,
      refundedAt: vouchers.refundedAt,
      refundReason: vouchers.refundReason,
    })
    .from(vouchers)
    .leftJoin(activationCodes, eq(vouchers.redeemedByCodeId, activationCodes.id))
    .orderBy(desc(vouchers.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await (conditions.length > 0
    ? rowsQuery.where(and(...conditions))
    : rowsQuery);

  // Stats — single aggregation query over the WHOLE table (no filter)
  // so the dashboard summary card shows true population totals.
  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      available: sql<number>`COUNT(*) FILTER (WHERE redeemed_at IS NULL AND revoked_at IS NULL)::int`,
      redeemed: sql<number>`COUNT(*) FILTER (WHERE redeemed_at IS NOT NULL AND refunded_at IS NULL)::int`,
      revoked: sql<number>`COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int`,
      refunded: sql<number>`COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)::int`,
      totalVndIssued: sql<number>`COALESCE(SUM(vnd_value), 0)::int`,
      totalEurCredited: sql<string>`COALESCE(SUM(CASE WHEN redeemed_at IS NOT NULL AND refunded_at IS NULL THEN eur_value ELSE 0 END), 0)::text`,
    })
    .from(vouchers);

  return NextResponse.json({
    ok: true,
    vouchers: rows,
    stats: {
      total: stats?.total ?? 0,
      available: stats?.available ?? 0,
      redeemed: stats?.redeemed ?? 0,
      revoked: stats?.revoked ?? 0,
      refunded: stats?.refunded ?? 0,
      totalVndIssued: stats?.totalVndIssued ?? 0,
      totalEurCredited: Number(stats?.totalEurCredited ?? "0"),
    },
  });
}
