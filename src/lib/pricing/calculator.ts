/**
 * Cost lookup for Freepik endpoints. Reads from the `pricing_rules` table,
 * which is seeded with Kling V3 defaults and editable via the admin
 * dashboard (Phase 10) so admins can adjust as Freepik prices change.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pricingRules } from "@/lib/db/schema";

export interface PricingLookup {
  endpoint: string;
  /** null for endpoints that don't differentiate by tier (e.g. improve-prompt) */
  tier: "pro" | "std" | null;
  /** null for endpoints that don't differentiate by duration */
  durationSeconds: number | null;
  withAudio: boolean;
}

export class PricingNotFoundError extends Error {
  readonly lookup: PricingLookup;
  constructor(lookup: PricingLookup) {
    super(
      `No pricing rule found for endpoint=${lookup.endpoint} tier=${lookup.tier} duration=${lookup.durationSeconds}s audio=${lookup.withAudio}`,
    );
    this.lookup = lookup;
    this.name = "PricingNotFoundError";
  }
}

/**
 * Look up the EUR cost for a request shape. Throws PricingNotFoundError
 * if the combination has no rule — admin must seed/edit one first.
 */
export async function calculateCost(lookup: PricingLookup): Promise<number> {
  const conditions: SQL[] = [
    eq(pricingRules.endpoint, lookup.endpoint),
    eq(pricingRules.withAudio, lookup.withAudio),
    lookup.tier === null
      ? isNull(pricingRules.tier)
      : eq(pricingRules.tier, lookup.tier),
    lookup.durationSeconds === null
      ? isNull(pricingRules.durationSeconds)
      : eq(pricingRules.durationSeconds, lookup.durationSeconds),
  ];

  const [row] = await db
    .select({ costEur: pricingRules.costEur })
    .from(pricingRules)
    .where(and(...conditions))
    .limit(1);

  if (!row) throw new PricingNotFoundError(lookup);
  return Number(row.costEur);
}

/**
 * Convenience wrapper for the Kling V3 endpoint — derives the lookup
 * from a generation request's params + tier.
 */
export function lookupForKlingV3(
  params: { duration?: string; generate_audio?: boolean },
  tier: "pro" | "std",
): PricingLookup {
  return {
    endpoint: "kling-v3",
    tier,
    // Default to 5s if not specified — matches Freepik's default.
    durationSeconds: params.duration ? Number(params.duration) : 5,
    withAudio: !!params.generate_audio,
  };
}

/** Convenience wrapper for the improve-prompt endpoint (always free). */
export function lookupForImprovePrompt(): PricingLookup {
  return {
    endpoint: "improve-prompt",
    tier: null,
    durationSeconds: null,
    withAudio: false,
  };
}
