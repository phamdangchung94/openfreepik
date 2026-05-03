/**
 * Smoke test for chargeCode + refundCode atomicity.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/test-charge.ts <CODE>
 *
 * Charges 1 EUR five times (should leave 5/10 EUR), then refunds 2 EUR
 * (should leave 7/10 EUR), then tries to charge 100 EUR (should fail).
 */

import { chargeCode, refundCode, validateCode } from "../src/lib/auth/activation";

const code = process.argv[2];
if (!code) {
  console.error("Usage: tsx scripts/test-charge.ts <CODE>");
  process.exit(1);
}

async function main() {
  const initial = await validateCode(code!);
  if (!initial.ok) {
    console.error("Code invalid:", initial.reason);
    process.exit(1);
  }

  const codeId = initial.metadata.codeId;
  console.log("Initial:", initial.metadata);

  // Charge 1 EUR five times concurrently
  console.log("\n5x parallel charge of 1.00 EUR each...");
  const results = await Promise.all(
    Array.from({ length: 5 }, () => chargeCode(codeId, 1)),
  );
  for (const [i, r] of results.entries()) {
    console.log(`  charge[${i}]:`, r ? `OK used=${r.usedEur}` : "REJECTED");
  }

  // Refund 2 EUR
  console.log("\nRefund 2.00 EUR...");
  await refundCode(codeId, 2);
  const after1 = await validateCode(code!);
  console.log("  after refund:", after1.ok ? after1.metadata : after1);

  // Try to overdraw
  console.log("\nTry to charge 100.00 EUR (should fail)...");
  const overdraw = await chargeCode(codeId, 100);
  console.log("  result:", overdraw ? "ALLOWED (BUG)" : "REJECTED ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
