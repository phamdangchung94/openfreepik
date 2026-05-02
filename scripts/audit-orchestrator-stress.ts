/**
 * Stress test for orchestrator correctness — used by the S7+S8+C2 audit.
 *
 * Runs against the configured DATABASE_URL. Creates a temporary code +
 * key, fires N parallel charges and N parallel pickActiveKey calls,
 * then cleans up.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/audit-orchestrator-stress.ts
 */

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import {
  activationCodes,
  freepikKeys,
} from "../src/lib/db/schema";
import { chargeCode, refundCode } from "../src/lib/auth/activation";
import { addKey, pickActiveKey } from "../src/lib/freepik/key-pool";

const QUOTA = 100;
const CHARGE = 1;
const PARALLEL_CHARGES = 100;
const PARALLEL_PICKS_SINGLE_KEY = 20;

async function setup() {
  const [code] = await db
    .insert(activationCodes)
    .values({
      code: `AUDIT-STRESS-${Date.now()}`,
      mode: "quota",
      quotaEur: QUOTA.toFixed(2),
      customerLabel: "stress test",
    })
    .returning();
  const { id: keyId } = await addKey({
    label: `AUDIT-STRESS-KEY-${Date.now()}`,
    plaintextKey: "FPSX-stress-fake",
    assignedEur: 50,
  });
  return { codeId: code!.id, keyId };
}

async function cleanup(codeId: string, keyId: string) {
  await db.delete(activationCodes).where(eq(activationCodes.id, codeId));
  await db.delete(freepikKeys).where(eq(freepikKeys.id, keyId));
}

async function main() {
  const { codeId, keyId } = await setup();
  console.log(`Code ${codeId} (quota ${QUOTA} EUR) + key ${keyId}`);

  try {
    // ---- TEST 1: high-concurrency charge race ----
    console.log(
      `\n[Test 1] ${PARALLEL_CHARGES}x parallel chargeCode of ${CHARGE} EUR (limit ${QUOTA})`,
    );
    const chargeResults = await Promise.all(
      Array.from({ length: PARALLEL_CHARGES }, () => chargeCode(codeId, CHARGE)),
    );
    const succeeded = chargeResults.filter((r) => r !== null).length;
    const rejected = chargeResults.length - succeeded;
    const finalUsed = chargeResults.reduce(
      (max, r) => (r && r.usedEur > max ? r.usedEur : max),
      0,
    );

    console.log(`  succeeded=${succeeded}, rejected=${rejected}`);
    console.log(`  max usedEur seen: ${finalUsed.toFixed(2)} (cap: ${QUOTA})`);
    if (succeeded > QUOTA / CHARGE) {
      console.error(`  ❌ OVERSPEND — got ${succeeded} charges, cap was ${QUOTA / CHARGE}`);
    } else if (succeeded === QUOTA / CHARGE) {
      console.log(`  ✓ Atomic charge held — exactly ${QUOTA / CHARGE} succeeded, ${rejected} rejected`);
    } else {
      console.log(`  ⚠ Under-utilized — only ${succeeded}/${QUOTA / CHARGE} succeeded`);
    }

    // Verify final DB state matches
    const [finalRow] = await db
      .select()
      .from(activationCodes)
      .where(eq(activationCodes.id, codeId))
      .limit(1);
    console.log(`  DB final usedEur: ${finalRow?.usedEur}`);

    // Reset for next test
    await refundCode(codeId, succeeded * CHARGE);

    // ---- TEST 2: refund race (concurrent charges + refunds) ----
    console.log(
      `\n[Test 2] 50 charges + 50 refunds interleaved`,
    );
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i++) {
      ops.push(chargeCode(codeId, 1));
      ops.push(refundCode(codeId, 1));
    }
    await Promise.all(ops);
    const [afterRow] = await db
      .select()
      .from(activationCodes)
      .where(eq(activationCodes.id, codeId))
      .limit(1);
    console.log(`  DB usedEur after equal charges/refunds: ${afterRow?.usedEur} (expect 0.00 ± epsilon)`);

    // Reset
    if (afterRow && Number(afterRow.usedEur) > 0) {
      await refundCode(codeId, Number(afterRow.usedEur));
    }

    // ---- TEST 3: pickActiveKey contention with only 1 key ----
    console.log(
      `\n[Test 3] ${PARALLEL_PICKS_SINGLE_KEY}x parallel pickActiveKey with ONLY 1 key in pool`,
    );
    const pickResults = await Promise.all(
      Array.from({ length: PARALLEL_PICKS_SINGLE_KEY }, () => pickActiveKey(0)),
    );
    const picked = pickResults.filter((r) => r !== null).length;
    const skipped = pickResults.filter((r) => r === null).length;
    console.log(`  picked=${picked}, returned-null=${skipped}`);
    if (skipped > 0) {
      console.log(
        `  ⚠ SKIP LOCKED returned null on ${skipped}/${PARALLEL_PICKS_SINGLE_KEY} calls → spurious 503 risk under contention`,
      );
    } else {
      console.log(
        `  ✓ All ${picked} pick calls got a key (lock contention serialized cleanly)`,
      );
    }

    // ---- TEST 4: charge after expires_at passes ----
    console.log(`\n[Test 4] Set expires_at = past, then charge → expect rejection`);
    await db
      .update(activationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(activationCodes.id, codeId));
    const expiredCharge = await chargeCode(codeId, 1);
    if (expiredCharge === null) {
      console.log(`  ✓ Expired code charge REJECTED`);
    } else {
      console.error(`  ❌ Expired code was charged anyway`);
    }

    // ---- TEST 5: refund clamping at 0 ----
    console.log(`\n[Test 5] Refund 9999 EUR on a code at 0 used → expect clamp at 0`);
    // Reset expires
    await db
      .update(activationCodes)
      .set({ expiresAt: null, usedEur: "0.00" })
      .where(eq(activationCodes.id, codeId));
    await refundCode(codeId, 9999);
    const [clamped] = await db
      .select()
      .from(activationCodes)
      .where(eq(activationCodes.id, codeId))
      .limit(1);
    if (Number(clamped?.usedEur ?? -1) === 0) {
      console.log(`  ✓ Refund clamped at 0 (usedEur stays 0.00)`);
    } else {
      console.error(`  ❌ Refund went negative or unexpected: ${clamped?.usedEur}`);
    }
  } finally {
    await cleanup(codeId, keyId);
    console.log("\nCleanup done.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Stress test failed:", err);
    process.exit(1);
  });
