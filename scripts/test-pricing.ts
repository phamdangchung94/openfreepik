/**
 * Smoke test for pricing calculator against the seeded pricing_rules table.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/test-pricing.ts
 */

import {
  calculateCost,
  lookupForImprovePrompt,
  lookupForKlingV3,
  PricingNotFoundError,
} from "../src/lib/pricing/calculator";

async function main() {
  // 2026-05-24: calculateCost now returns { customerPriceEur, upstreamCostEur }
  // (migration 0021 — 2-layer pricing). Smoke test only verifies the
  // customer-facing price; upstream margin is admin-only.
  console.log("[1] Kling V3 std/5s/no-audio (default Freepik shape)");
  const std5 = await calculateCost(lookupForKlingV3({ duration: "5" }, "std"));
  console.log(`  customer = ${std5.customerPriceEur} EUR, upstream = ${std5.upstreamCostEur} EUR (expect customer 0.25)`);
  if (std5.customerPriceEur !== 0.25)
    throw new Error(`expected 0.25, got ${std5.customerPriceEur}`);

  console.log("\n[2] Kling V3 pro/10s/with audio");
  const pro10audio = await calculateCost(
    lookupForKlingV3({ duration: "10", generate_audio: true }, "pro"),
  );
  console.log(`  customer = ${pro10audio.customerPriceEur} EUR, upstream = ${pro10audio.upstreamCostEur} EUR (expect customer 1.40)`);
  if (Math.abs(pro10audio.customerPriceEur - 1.4) > 0.001) {
    throw new Error(`expected 1.40, got ${pro10audio.customerPriceEur}`);
  }

  console.log("\n[3] Kling V3 pro default (no duration in params → falls back to 5s)");
  const proDefault = await calculateCost(lookupForKlingV3({}, "pro"));
  console.log(`  customer = ${proDefault.customerPriceEur} EUR (expect 0.50)`);
  if (proDefault.customerPriceEur !== 0.5)
    throw new Error(`expected 0.50, got ${proDefault.customerPriceEur}`);

  console.log("\n[4] Improve-prompt is free");
  const improve = await calculateCost(lookupForImprovePrompt());
  console.log(`  customer = ${improve.customerPriceEur} EUR (expect 0)`);
  if (improve.customerPriceEur !== 0)
    throw new Error(`expected 0, got ${improve.customerPriceEur}`);

  console.log("\n[5] Unknown combination throws PricingNotFoundError");
  try {
    await calculateCost({
      endpoint: "kling-v3",
      tier: "pro",
      durationSeconds: 99,
      withAudio: false,
    });
    throw new Error("expected PricingNotFoundError, got none");
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      console.log(`  rejected ✓ (${err.message.slice(0, 80)}…)`);
    } else {
      throw err;
    }
  }

  console.log("\nAll pricing checks pass.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
