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
// Audio adds ~40% based on Freepik's public credit pricing.
const RATES = {
  std: { perSecond: 0.05, audioMultiplier: 1.4 },
  pro: { perSecond: 0.10, audioMultiplier: 1.4 },
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
