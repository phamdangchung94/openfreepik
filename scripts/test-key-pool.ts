/**
 * Smoke test for AES-GCM round-trip + key-pool rotation.
 *
 * 1. Encrypt/decrypt a string and verify it matches.
 * 2. Add 3 fake keys with different LRU timestamps.
 * 3. Pick keys repeatedly — verify LRU order rotates.
 * 4. Mark one key exhausted, pick again — verify it's skipped.
 * 5. Pick with cost > all remaining budget — verify null.
 *
 * After running, the 3 test keys are deleted to keep the DB clean.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/test-key-pool.ts
 */

import { eq, like } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { freepikKeys } from "../src/lib/db/schema";
import { decrypt, encrypt } from "../src/lib/crypto/aes-gcm";
import {
  addKey,
  markKeyExhausted,
  pickActiveKey,
  recordKeyCost,
} from "../src/lib/freepik/key-pool";

async function cleanup() {
  await db.delete(freepikKeys).where(like(freepikKeys.label, "TEST-KEY-%"));
}

async function main() {
  console.log("[1] AES round-trip");
  const ct = await encrypt("hello world");
  const pt = await decrypt(ct);
  console.log(`  encrypted (${ct.length} chars), decrypted="${pt}"`);
  if (pt !== "hello world") throw new Error("AES round-trip failed");

  await cleanup();

  console.log("\n[2] Add 3 test keys with low budget");
  const keyA = await addKey({
    label: "TEST-KEY-A",
    plaintextKey: "FPSX-fake-A",
    assignedEur: 5,
  });
  const keyB = await addKey({
    label: "TEST-KEY-B",
    plaintextKey: "FPSX-fake-B",
    assignedEur: 5,
  });
  const keyC = await addKey({
    label: "TEST-KEY-C",
    plaintextKey: "FPSX-fake-C",
    assignedEur: 5,
  });
  console.log(`  A=${keyA.id}\n  B=${keyB.id}\n  C=${keyC.id}`);

  console.log("\n[3] Pick 5 times, expect LRU rotation A → B → C → A → B");
  for (let i = 0; i < 5; i++) {
    const picked = await pickActiveKey(0.5);
    if (!picked) throw new Error("pickActiveKey returned null unexpectedly");
    await recordKeyCost(picked.id, 0.5);
    console.log(`  pick[${i}]: ${picked.label} (${picked.decryptedKey})`);
  }

  console.log("\n[4] Mark A exhausted, pick 4 more — expect only B and C");
  await markKeyExhausted(keyA.id);
  for (let i = 0; i < 4; i++) {
    const picked = await pickActiveKey(0.5);
    if (!picked) {
      console.log(`  pick[${i}]: NULL (no active key)`);
      break;
    }
    await recordKeyCost(picked.id, 0.5);
    console.log(`  pick[${i}]: ${picked.label}`);
    if (picked.label === "TEST-KEY-A") {
      throw new Error("Picked an exhausted key — bug");
    }
  }

  console.log("\n[5] Try to pick with cost=100 (no key has 100 EUR)");
  const huge = await pickActiveKey(100);
  console.log(`  result: ${huge ? "ALLOWED (BUG)" : "REJECTED ✓"}`);

  console.log("\n[6] Cleanup");
  await cleanup();
  console.log("  done");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
