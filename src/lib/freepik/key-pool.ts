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
 * Uses plain `FOR UPDATE` (not SKIP LOCKED) — a contended request waits
 * ~50ms for the lock instead of returning null. SKIP LOCKED was dropped
 * after the post-launch audit (#3) showed it caused spurious 503s under
 * burst traffic when the pool had only 1 active key.
 *
 * `excludeKeyIds` lets the orchestrator's retry loop skip keys it has
 * already tried this request — without this, a 1-key pool burns all 3
 * retry slots on the same key (audit P1-3).
 *
 * Returns null only if NO active key has enough remaining budget AND
 * isn't in the exclude list.
 */
export async function pickActiveKey(
  estimatedCostEur: number,
  excludeKeyIds: ReadonlySet<string> = new Set(),
): Promise<PickedKey | null> {
  const cost = Math.max(estimatedCostEur, 0).toFixed(2);
  // Build the NOT-IN list as a SQL ARRAY[…] literal. UUIDs are validated
  // shape-wise by Drizzle on the way in (they came from our own DB
  // records originally), so straight `${id}::uuid` interpolation is fine.
  const excludeArray =
    excludeKeyIds.size === 0
      ? sql`'{}'::uuid[]`
      : sql.join(
          [...excludeKeyIds].map((id) => sql`${id}::uuid`),
          sql`,`,
        );
  const excludeClause =
    excludeKeyIds.size === 0
      ? sql`TRUE`
      : sql`id <> ALL(ARRAY[${excludeArray}]::uuid[])`;

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
        AND ${excludeClause}
      ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
      FOR UPDATE
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
