/**
 * Freepik API key pool — admin-managed list of keys, encrypted at rest.
 * Each new Freepik account starts with 500 EUR free credit; this module
 * picks the least-recently-used active key with enough remaining budget,
 * marks keys exhausted when Freepik returns 402, and tracks per-key spend.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys, type NewFreepikKey } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto/aes-gcm";

export interface PickedKey {
  id: string;
  label: string;
  decryptedKey: string;
}

/**
 * Atomically pick the LRU active key with enough budget for `estimatedCostEur`,
 * touch its `last_used_at`, and return its decrypted plaintext.
 *
 * Uses `FOR UPDATE SKIP LOCKED` inside a CTE so two concurrent requests
 * never grab the same row when the pool is contended.
 *
 * Returns null if no active key has enough remaining budget.
 */
export async function pickActiveKey(
  estimatedCostEur: number,
): Promise<PickedKey | null> {
  const cost = Math.max(estimatedCostEur, 0).toFixed(2);

  const result = await db.execute<{
    id: string;
    label: string;
    key_encrypted: string;
  }>(sql`
    WITH picked AS (
      SELECT id
      FROM freepik_keys
      WHERE is_active
        AND (assigned_eur - used_eur) >= ${cost}::numeric
      ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE freepik_keys
    SET last_used_at = now()
    FROM picked
    WHERE freepik_keys.id = picked.id
    RETURNING freepik_keys.id, freepik_keys.label, freepik_keys.key_encrypted;
  `);

  // Neon HTTP driver returns { rows: T[], ... } despite the generic shape.
  const rows = (result as unknown as { rows: Array<{ id: string; label: string; key_encrypted: string }> }).rows;
  const row = rows[0];
  if (!row) return null;

  const decryptedKey = await decrypt(row.key_encrypted);
  return { id: row.id, label: row.label, decryptedKey };
}

/**
 * Mark a key inactive — used after Freepik returns a quota/auth error
 * indicating the key has hit its 500 EUR limit (or got revoked upstream).
 */
export async function markKeyExhausted(keyId: string): Promise<void> {
  await db
    .update(freepikKeys)
    .set({ isActive: false })
    .where(eq(freepikKeys.id, keyId));
}

/**
 * Increment a key's tracked spend. Called on every successful Freepik
 * request (and never refunded — server-side accounting is the source of
 * truth for "how much have we burned on this Freepik account").
 */
export async function recordKeyCost(
  keyId: string,
  costEur: number,
): Promise<void> {
  if (costEur <= 0) return;
  const cost = costEur.toFixed(2);
  await db
    .update(freepikKeys)
    .set({ usedEur: sql`${freepikKeys.usedEur} + ${cost}` })
    .where(eq(freepikKeys.id, keyId));
}

export interface AddKeyOptions {
  label: string;
  plaintextKey: string;
  assignedEur?: number;
  notes?: string;
}

/**
 * Encrypt and insert a new Freepik key. Used by the admin CLI today
 * (scripts/admin-add-key.ts) and by the admin dashboard in Phase 10.
 */
export async function addKey(opts: AddKeyOptions): Promise<{ id: string }> {
  const keyEncrypted = await encrypt(opts.plaintextKey);
  const row: NewFreepikKey = {
    label: opts.label,
    keyEncrypted,
    assignedEur: (opts.assignedEur ?? 500).toFixed(2),
    notes: opts.notes,
  };
  const [inserted] = await db.insert(freepikKeys).values(row).returning();
  if (!inserted) throw new Error("Insert returned no rows");
  return { id: inserted.id };
}
