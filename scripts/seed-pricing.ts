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
// 2026-05-06: EMPIRICALLY MEASURED via 5-test calibration against the
// Magnific dashboard balance (see scripts/calibrate-pricing.ts). Public
// docs underreported audio multiplier (claimed 1.5x, actual 1.83x for
// std and 1.75x for pro). Linearity in duration verified at 0% drift
// between 5s and 10s pro+audio runs.
//
// Standard:  0.168/s no audio,  0.308/s audio  (audio mult 1.833x)
// Pro:       0.224/s no audio,  0.392/s audio  (audio mult 1.75x)
//
// Pro is 33% pricier than Standard. Audio multipliers differ by tier
// so a single shared multiplier doesn't capture reality — using
// per-tier audio rate now.
const RATES = {
  std: { perSecond: 0.168, perSecondAudio: 0.308 },
  pro: { perSecond: 0.224, perSecondAudio: 0.392 },
} as const;

const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

function buildRules(): NewPricingRule[] {
  const rules: NewPricingRule[] = [];

  for (const tier of ["std", "pro"] as const) {
    const rate = RATES[tier];
    for (const duration of DURATIONS) {
      // Without audio
      rules.push({
        endpoint: "kling-v3",
        tier,
        durationSeconds: duration,
        withAudio: false,
        costEur: (rate.perSecond * duration).toFixed(2),
      });
      // With audio — uses tier-specific rate (audio multiplier
      // differs between std and pro per measured data).
      rules.push({
        endpoint: "kling-v3",
        tier,
        durationSeconds: duration,
        withAudio: true,
        costEur: (rate.perSecondAudio * duration).toFixed(2),
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
