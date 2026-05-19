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
  tier: "pro" | "std" | "4k" | null;
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

/**
 * Convenience wrapper for Kling 4K (T2V + I2V).
 *
 * Kling 4K is exposed to customers as a tier of Kling 3 ("4K" alongside
 * "1080p Pro" and "720p Std"), but Magnific bills it through separate
 * endpoint URLs — `kling-4k-t2v` and `kling-4k-i2v`. The pricing_rules
 * row stores tier='4k' so admin can see all three tiers side-by-side
 * in the admin pricing page.
 *
 * Audio rate parity: per business rule, Kling 4K costs the same whether
 * generate_audio is true or false (different from Kling 3 where audio
 * costs ~1.75× the silent rate). Both rows are seeded at 1.12 EUR/s ×
 * duration; the withAudio dimension just disambiguates the lookup.
 */
export function lookupForKling4k(
  endpoint: "kling-4k-t2v" | "kling-4k-i2v",
  params: { duration?: string | number; generate_audio?: boolean },
): PricingLookup {
  const duration =
    typeof params.duration === "number"
      ? params.duration
      : params.duration
        ? Number(params.duration)
        : 5;
  return {
    endpoint,
    tier: "4k",
    durationSeconds: duration,
    withAudio: !!params.generate_audio,
  };
}

/**
 * Convenience wrapper for WAN 2.7 image-to-video. WAN doesn't have
 * tiers (all calls are equal quality at the chosen resolution); we
 * encode the resolution into the `tier` slot of the lookup so admin
 * can seed `720P` vs `1080P` rates without adding a column. Audio is
 * not a price modifier on WAN — `withAudio` is always false.
 */
export function lookupForWanV27(
  params: { duration?: number; resolution?: "720P" | "1080P" },
): PricingLookup {
  return {
    endpoint: "wan-v27",
    // Reuse `tier` to carry resolution since pricing_rules already
    // splits by tier. "pro" = 1080P (default), "std" = 720P. Mapped
    // back at admin dashboard for clarity in the seed file.
    tier: params.resolution === "720P" ? "std" : "pro",
    durationSeconds: params.duration ?? 5,
    withAudio: false,
  };
}

/**
 * Convenience wrapper for Kling Motion Control. The endpoint string
 * already encodes both version + tier (e.g. `kling-motion-v3-pro`),
 * so the `tier` slot of the lookup is left null — admin pricing rows
 * live under endpoint + duration alone.
 *
 * Pricing per second confirmed by admin 2026-05-19 (Magnific dashboard):
 *   v2-6-std: 0.059 EUR/s    v2-6-pro: 0.118 EUR/s
 *   v3-std:   0.126 EUR/s    v3-pro:   0.168 EUR/s
 *
 * Allowed output durations: 5, 10, 15, 30 (5/10 only when
 * character_orientation=image; the route handler enforces this).
 * Audio is not a price modifier — motion control doesn't generate
 * audio, so `withAudio` is always false.
 */
export function lookupForKlingMotion(
  version: "v2-6" | "v3",
  tier: "std" | "pro",
  durationSeconds: number,
): PricingLookup {
  return {
    endpoint: `kling-motion-${version}-${tier}`,
    tier: null,
    durationSeconds,
    withAudio: false,
  };
}
