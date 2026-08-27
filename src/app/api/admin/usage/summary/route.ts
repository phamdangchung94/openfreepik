import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rawRows } from "@/lib/db/raw-rows";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/usage/summary
 *
 * Aggregates for the admin dashboard:
 *   - byTier:     succeeded video count + EUR per tier (pro / std)
 *   - byCustomer: top N customers by spend (label + total EUR + count)
 *   - byDay:      last 14 days of EUR spent (for the spark/bar chart)
 *   - totals:     all-time + today + last 7 days
 *
 * Reads succeeded rows only — refunded/failed entries don't represent
 * real spend so including them would skew the totals admin uses to
 * verify Magnific bills.
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  // One round-trip with multiple CTEs would be ideal; Drizzle's typed
  // builders don't compose CTEs cleanly here, so 4 small queries it is
  // — each is sub-50ms with the existing indexes.

  const byTier = await db.execute<{
    tier: string | null;
    videos: string;
    eur: string;
  }>(sql`
    SELECT
      tier,
      COUNT(*)::text AS videos,
      COALESCE(SUM(cost_eur), 0)::numeric::text AS eur
    FROM usage_logs
    WHERE status = 'succeeded' AND endpoint = 'kling-v3'
    GROUP BY tier
    ORDER BY tier
  `);

  const byCustomer = await db.execute<{
    code_id: string;
    label: string | null;
    videos: string;
    eur: string;
  }>(sql`
    SELECT
      u.code_id,
      a.customer_label AS label,
      COUNT(*)::text AS videos,
      COALESCE(SUM(u.cost_eur), 0)::numeric::text AS eur
    FROM usage_logs u
    LEFT JOIN activation_codes a ON a.id = u.code_id
    WHERE u.status = 'succeeded'
    GROUP BY u.code_id, a.customer_label
    ORDER BY SUM(u.cost_eur) DESC NULLS LAST
    LIMIT 10
  `);

  const byDay = await db.execute<{
    day: string;
    videos: string;
    eur: string;
  }>(sql`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::text AS videos,
      COALESCE(SUM(cost_eur), 0)::numeric::text AS eur
    FROM usage_logs
    WHERE
      status = 'succeeded'
      AND created_at >= now() - interval '14 days'
    GROUP BY day
    ORDER BY day
  `);

  const totals = await db.execute<{
    all_videos: string;
    all_eur: string;
    today_videos: string;
    today_eur: string;
    week_videos: string;
    week_eur: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS all_videos,
      COALESCE(SUM(cost_eur), 0)::numeric::text AS all_eur,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::text AS today_videos,
      COALESCE(SUM(cost_eur) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::numeric::text AS today_eur,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::text AS week_videos,
      COALESCE(SUM(cost_eur) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::numeric::text AS week_eur
    FROM usage_logs
    WHERE status = 'succeeded'
  `);

  type TierRow = { tier: string | null; videos: string; eur: string };
  type CustRow = {
    code_id: string;
    label: string | null;
    videos: string;
    eur: string;
  };
  type DayRow = { day: string; videos: string; eur: string };
  type TotRow = {
    all_videos: string;
    all_eur: string;
    today_videos: string;
    today_eur: string;
    week_videos: string;
    week_eur: string;
  };

  const tierRows = rawRows<TierRow>(byTier);
  const custRows = rawRows<CustRow>(byCustomer);
  const dayRows = rawRows<DayRow>(byDay);
  const totRow = rawRows<TotRow>(totals)[0];

  return NextResponse.json({
    ok: true,
    byTier: tierRows.map((r) => ({
      tier: r.tier,
      videos: Number(r.videos),
      eur: Number(r.eur),
    })),
    byCustomer: custRows.map((r) => ({
      codeId: r.code_id,
      label: r.label,
      videos: Number(r.videos),
      eur: Number(r.eur),
    })),
    byDay: dayRows.map((r) => ({
      day: r.day,
      videos: Number(r.videos),
      eur: Number(r.eur),
    })),
    totals: totRow
      ? {
          all: { videos: Number(totRow.all_videos), eur: Number(totRow.all_eur) },
          today: {
            videos: Number(totRow.today_videos),
            eur: Number(totRow.today_eur),
          },
          week: {
            videos: Number(totRow.week_videos),
            eur: Number(totRow.week_eur),
          },
        }
      : null,
  });
}
