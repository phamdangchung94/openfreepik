import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pricingRules } from "@/lib/db/schema";

/**
 * GET /api/pricing/rates
 *
 * Returns the full pricing matrix so the generator form can show a
 * real-time cost preview as the customer changes tier / duration / audio.
 * Public — no auth needed; the rates are already shown to the customer
 * indirectly via their balance ticking down.
 *
 * Lightweight payload (~3KB for ~53 rules) — fetched once at form mount
 * and cached client-side.
 */
export async function GET() {
  const rows = await db
    .select({
      endpoint: pricingRules.endpoint,
      tier: pricingRules.tier,
      durationSeconds: pricingRules.durationSeconds,
      withAudio: pricingRules.withAudio,
      costEur: pricingRules.costEur,
    })
    .from(pricingRules)
    .orderBy(
      asc(pricingRules.endpoint),
      asc(pricingRules.tier),
      asc(pricingRules.durationSeconds),
    );

  return NextResponse.json({
    rules: rows.map((r) => ({ ...r, costEur: Number(r.costEur) })),
  });
}
