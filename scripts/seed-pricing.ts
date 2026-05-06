/**
 * Seed pricing rules with Freepik Kling V3 public defaults.
 * Idempotent — uses ON CONFLICT to skip existing combinations.
 *
 * Usage: DATABASE_URL=postgres://... pnpm tsx scripts/seed-pricing.ts
 */

import { db } from "../src/lib/db/client";
import { pricingRules, type NewPricingRule } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

// Per-second rates (EUR). Multiply by duration to get base cost.
//
// 2026-05-06: aligned to Magnific's public Kling 3 API rates so DB
// charges match what Magnific bills our pool keys. Sources:
//   - https://docs.magnific.com/api-reference/video/kling-v3/overview
//   - https://invideo.io / soravideo.art / multiple resellers cross-checked
//
// Pricing in USD on those sources but Magnific bills accounts in EUR
// at parity (free trial advertised as "500 EUR", balance display in EUR).
//
// Standard:  0.168/s no audio,  0.252/s audio  (1.5x multiplier)
// Pro:       0.224/s no audio,  0.336/s audio  (1.5x multiplier)
//
// Pro is 33% pricier than Standard. Audio adds 50% on top of either.
//
// Replace with measured values once the per-call billing matrix has
// been verified against Magnific dashboard's exact deltas.
const RATES = {
  std: { perSecond: 0.168, audioMultiplier: 1.5 },
  pro: { perSecond: 0.224, audioMultiplier: 1.5 },
} as const;

const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

function buildRules(): NewPricingRule[] {
  const rules: NewPricingRule[] = [];

  for (const tier of ["std", "pro"] as const) {
    const rate = RATES[tier];
    for (const duration of DURATIONS) {
      const baseCost = rate.perSecond * duration;
      // Without audio
      rules.push({
        endpoint: "kling-v3",
        tier,
        durationSeconds: duration,
        withAudio: false,
        costEur: baseCost.toFixed(2),
      });
      // With audio
      rules.push({
        endpoint: "kling-v3",
        tier,
        durationSeconds: duration,
        withAudio: true,
        costEur: (baseCost * rate.audioMultiplier).toFixed(2),
      });
    }
  }

  // Improve-prompt is free
  rules.push({
    endpoint: "improve-prompt",
    tier: null,
    durationSeconds: null,
    withAudio: false,
    costEur: "0.00",
  });

  return rules;
}

async function main() {
  const rules = buildRules();
  console.log(`Seeding ${rules.length} pricing rules...`);

  await db
    .insert(pricingRules)
    .values(rules)
    .onConflictDoUpdate({
      target: [
        pricingRules.endpoint,
        pricingRules.tier,
        pricingRules.durationSeconds,
        pricingRules.withAudio,
      ],
      set: {
        costEur: sql`excluded.cost_eur`,
        updatedAt: sql`now()`,
      },
    });

  console.log(`Done. Sample rules:`);
  const sample = await db
    .select()
    .from(pricingRules)
    .limit(5);
  console.table(sample);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
