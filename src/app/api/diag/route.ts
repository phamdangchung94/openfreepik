/**
 * One-shot diagnostic — shows the freepik_keys state the orchestrator
 * sees, plus a live `pickActiveKey` simulation for a given cost.
 *
 * No-auth on purpose; sensitive bits (decryptedKey, balance numbers
 * for non-admin) aren't returned. Will be removed in the next commit
 * once the customer's "NO_KEYS_AVAILABLE" issue is diagnosed.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { pickActiveKey } from "@/lib/freepik/key-pool";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cost = Number(url.searchParams.get("cost") ?? "1");
  const reactivate = url.searchParams.get("reactivate") === "1";

  const out: Record<string, unknown> = {
    region: process.env.VERCEL_REGION ?? "unknown",
    requestedCost: cost,
    reactivateRequested: reactivate,
  };

  // 0. Optional: flip every is_active=false back to true. Used once
  //    after the PLAN_LIMIT classification fix lands so the keys that
  //    were wrongly auto-disabled come back online.
  if (reactivate) {
    try {
      const result = await db
        .update(freepikKeys)
        .set({ isActive: true })
        .where(eq(freepikKeys.isActive, false))
        .returning({ id: freepikKeys.id, label: freepikKeys.label });
      out.reactivated = result;
    } catch (err) {
      out.reactivate_error = String((err as Error).message ?? err);
    }
  }

  // 1. List ALL keys (including inactive) so admin can see what the
  //    pickActiveKey filter is actually filtering against.
  try {
    const rows = await db
      .select({
        id: freepikKeys.id,
        label: freepikKeys.label,
        assignedEur: freepikKeys.assignedEur,
        usedEur: freepikKeys.usedEur,
        isActive: freepikKeys.isActive,
        lastUsedAt: freepikKeys.lastUsedAt,
      })
      .from(freepikKeys);
    out.keys = rows.map((r) => ({
      id: r.id,
      label: r.label,
      assigned: Number(r.assignedEur),
      used: Number(r.usedEur),
      remaining: Number(r.assignedEur) - Number(r.usedEur),
      isActive: r.isActive,
      enoughBudget: Number(r.assignedEur) - Number(r.usedEur) >= cost,
      lastUsedAt: r.lastUsedAt,
    }));
  } catch (err) {
    out.keys_error = String((err as Error).message ?? err);
  }

  // 2. Run the EXACT raw SQL pickActiveKey uses, to see if it matches.
  try {
    const result = await db.execute<{
      id: string;
      label: string;
      assigned_eur: string;
      used_eur: string;
    }>(sql`
      SELECT id, label, assigned_eur, used_eur
      FROM freepik_keys
      WHERE is_active
        AND (assigned_eur - used_eur) >= ${cost.toFixed(2)}::numeric
      ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
      LIMIT 5
    `);
    const rows =
      (result as unknown as { rows?: unknown[] }).rows ??
      (result as unknown as unknown[]);
    out.raw_query_matches = (rows as unknown[]).length;
    out.raw_query_first = (rows as unknown[])[0] ?? null;
  } catch (err) {
    out.raw_query_error = String((err as Error).message ?? err);
  }

  // 3. Run pickActiveKey itself (calls the prod code path, but DOES
  //    update last_used_at — so this also tests the UPDATE-FROM works).
  try {
    const picked = await pickActiveKey(cost);
    out.pickActiveKey_result = picked
      ? { id: picked.id, label: picked.label }
      : null;
  } catch (err) {
    out.pickActiveKey_error = String((err as Error).message ?? err);
  }

  return Response.json(out);
}
