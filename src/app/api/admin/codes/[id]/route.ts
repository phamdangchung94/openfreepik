import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

/**
 * GET /api/admin/codes/[id] — full per-code dossier for the drilldown
 * page. Returns:
 *   - The code itself (mode, quota, used, status, expiry).
 *   - Aggregate counters (total tasks by status, total spend).
 *   - Daily spend + task count series (last 30 days).
 *   - Recent tasks (last 50) for the in-page mini log.
 *
 * Keep payload small enough for a single page render; CSV export is a
 * separate endpoint that streams the full task history.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [code] = await db
    .select()
    .from(activationCodes)
    .where(eq(activationCodes.id, id))
    .limit(1);

  if (!code) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Code not found." },
      { status: 404 },
    );
  }

  // Aggregate counters — single query GROUP BY status.
  const aggRows = await db
    .select({
      status: usageLogs.status,
      count: sql<number>`count(*)::int`,
      totalEur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::text`,
    })
    .from(usageLogs)
    .where(eq(usageLogs.codeId, id))
    .groupBy(usageLogs.status);

  // Daily series, last 30 days. date_trunc('day') groups consistently
  // across timezones (server runs UTC anyway).
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageLogs.createdAt}), 'YYYY-MM-DD')`,
      tasks: sql<number>`count(*)::int`,
      eur: sql<string>`COALESCE(SUM(${usageLogs.costEur}), 0)::text`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.codeId, id),
        sql`${usageLogs.createdAt} > now() - interval '30 days'`,
      ),
    )
    .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
    .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`);

  // Recent 50 tasks — mini log view inside the page.
  const recent = await db
    .select({
      id: usageLogs.id,
      createdAt: usageLogs.createdAt,
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      status: usageLogs.status,
      errorMessage: usageLogs.errorMessage,
      prompt: usageLogs.prompt,
      freepikTaskId: usageLogs.freepikTaskId,
    })
    .from(usageLogs)
    .where(eq(usageLogs.codeId, id))
    .orderBy(desc(usageLogs.createdAt))
    .limit(50);

  return NextResponse.json({
    ok: true,
    code,
    aggregate: aggRows,
    daily: dailyRows,
    recent,
  });
}

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  customerLabel: z.string().max(120).nullable().optional(),
  /** Replace the quota cap (quota/topup modes only). */
  quotaEur: z.number().min(0).nullable().optional(),
  /** Increment current quota — convenience for top-up mode. Race-safe SQL. */
  addEur: z.number().positive().optional(),
});

/** PATCH /api/admin/codes/[id] — revoke, edit label, or top up balance. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.customerLabel !== undefined)
    updates.customerLabel = parsed.data.customerLabel;

  if (parsed.data.addEur !== undefined) {
    // Atomic increment — wins over a read-modify-write if two top-ups race.
    const amount = parsed.data.addEur.toFixed(2);
    updates.quotaEur = sql`COALESCE(${activationCodes.quotaEur}, 0) + ${amount}`;
  } else if (parsed.data.quotaEur !== undefined) {
    updates.quotaEur = parsed.data.quotaEur?.toFixed(2) ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "No fields to update." },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(activationCodes)
    .set(updates)
    .where(eq(activationCodes.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Code not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, updated });
}
