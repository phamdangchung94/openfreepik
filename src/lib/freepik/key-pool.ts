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
  // Reference k.id explicitly — the picked CTE joins inflight which
  // also has a key_id column; bare `id` would error as ambiguous in
  // some Postgres versions even though the join is LEFT.
  const excludeClause =
    excludeKeyIds.size === 0
      ? sql`TRUE`
      : sql`k.id <> ALL(ARRAY[${excludeArray}]::uuid[])`;

  // Per-key concurrency limit (migration 0006). "In-flight" =
  // tasks created in the last 5 minutes whose poll hasn't yet
  // observed COMPLETED (video_url IS NULL). Self-healing: a crashed
  // task stops counting after 5 minutes regardless of explicit
  // decrement, so leaks don't permanently block the key.
  //
  // The CTE chain:
  //   1. inflight  — count of in-flight tasks per key.
  //   2. picked    — first eligible key (LRU, has budget, not in
  //                  exclude list, AND inflight < max_concurrent).
  //   3. UPDATE    — touch last_used_at on the picked row.
  const result = await db.execute<{
    id: string;
    label: string;
    key_encrypted: string;
  }>(sql`
    WITH inflight AS (
      SELECT key_id, COUNT(*)::int AS n
      FROM usage_logs
      WHERE key_id IS NOT NULL
        AND created_at > now() - interval '5 minutes'
        AND status = 'succeeded'
        AND video_url IS NULL
      GROUP BY key_id
    ),
    picked AS (
      SELECT k.id
      FROM freepik_keys k
      LEFT JOIN inflight i ON i.key_id = k.id
      WHERE k.is_active
        AND (k.assigned_eur - k.used_eur) >= ${cost}::numeric
        AND ${excludeClause}
        AND COALESCE(i.n, 0) < k.max_concurrent
        -- Skip keys auto-paused by the healthcheck (rate-limit burst).
        -- NULL = never paused; past-timestamp = pause window expired.
        AND (k.paused_until IS NULL OR k.paused_until < now())
      ORDER BY k.last_used_at ASC NULLS FIRST, k.created_at ASC
      FOR UPDATE OF k
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
 * Diagnostic snapshot of the pool — used by the orchestrator's
 * NO_KEYS_AVAILABLE warning so admin can tell from Vercel logs
 * whether the pool was empty because keys are inactive, out of
 * budget, or simply none exist. Cheap aggregate query, no
 * sensitive data returned.
 */
export async function keyPoolStats(costEur: number): Promise<{
  totalKeys: number;
  activeKeys: number;
  activeWithBudget: number;
  /** Active keys not currently saturated by per-key concurrency limit. */
  activeWithSlots: number;
}> {
  const cost = Math.max(costEur, 0).toFixed(2);
  const result = await db.execute<{
    total: string;
    active: string;
    active_with_budget: string;
    active_with_slots: string;
  }>(sql`
    WITH inflight AS (
      SELECT key_id, COUNT(*)::int AS n
      FROM usage_logs
      WHERE key_id IS NOT NULL
        AND created_at > now() - interval '5 minutes'
        AND status = 'succeeded'
        AND video_url IS NULL
      GROUP BY key_id
    )
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE is_active)::text AS active,
      COUNT(*) FILTER (
        WHERE is_active AND (assigned_eur - used_eur) >= ${cost}::numeric
      )::text AS active_with_budget,
      COUNT(*) FILTER (
        WHERE is_active
          AND (assigned_eur - used_eur) >= ${cost}::numeric
          AND COALESCE(
                (SELECT n FROM inflight WHERE inflight.key_id = freepik_keys.id),
                0
              ) < freepik_keys.max_concurrent
      )::text AS active_with_slots
    FROM freepik_keys;
  `);
  const rows = (result as unknown as { rows: Array<{ total: string; active: string; active_with_budget: string; active_with_slots: string }> }).rows;
  const row = rows[0] ?? { total: "0", active: "0", active_with_budget: "0", active_with_slots: "0" };
  return {
    activeWithSlots: Number(row.active_with_slots),
    totalKeys: Number(row.total),
    activeKeys: Number(row.active),
    activeWithBudget: Number(row.active_with_budget),
  };
}

/**
 * Look up a specific key by id and return its decrypted plaintext.
 * Used by poll routes to preserve the "task lives on the account that
 * created it" invariant — Magnific only returns task status to the
 * account that owns the task. Picking an LRU key from the pool on
 * every poll causes ~75% of polls to hit unrelated accounts and
 * surface as 404 'Task not found' (see audit 2026-05-12).
 *
 * Returns null on:
 *   - row not found (key deleted)
 *   - decrypt failure (KEY_ENCRYPTION_SECRET rotated for this row)
 * Does NOT filter by is_active — a temporarily-deactivated key can
 * still own in-flight tasks that need draining. Caller decides what
 * to do with a null return (typically: fall back to pickActiveKey).
 */
export async function pickKeyById(keyId: string): Promise<PickedKey | null> {
  const rows = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      keyEncrypted: freepikKeys.keyEncrypted,
    })
    .from(freepikKeys)
    .where(eq(freepikKeys.id, keyId))
    .limit(1);

  const [row] = rows;
  if (!row) return null;
  try {
    const decryptedKey = await decrypt(row.keyEncrypted);
    return { id: row.id, label: row.label, decryptedKey };
  } catch {
    return null;
  }
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
  /**
   * Optional Magnific webhook signing secret. When supplied, the
   * orchestrator opts this key into webhook delivery — Magnific
   * posts task completions back instead of (or in addition to) the
   * client poll.
   */
  webhookSecret?: string;
  assignedEur?: number;
  notes?: string;
}

/**
 * Encrypt and insert a new Freepik key. Used by the admin CLI today
 * (scripts/admin-add-key.ts) and by the admin dashboard.
 */
export async function addKey(opts: AddKeyOptions): Promise<{ id: string }> {
  const keyEncrypted = await encrypt(opts.plaintextKey);
  const webhookSecretEncrypted = opts.webhookSecret
    ? await encrypt(opts.webhookSecret)
    : null;
  const row: NewFreepikKey = {
    label: opts.label,
    keyEncrypted,
    webhookSecretEncrypted,
    assignedEur: (opts.assignedEur ?? 500).toFixed(2),
    notes: opts.notes,
  };
  const [inserted] = await db.insert(freepikKeys).values(row).returning();
  if (!inserted) throw new Error("Insert returned no rows");
  return { id: inserted.id };
}

/**
 * Pick an active key that has a webhook secret configured. Used by
 * the webhook receiver to verify incoming Magnific callbacks — we try
 * each candidate's secret against the signature header. Returns the
 * decrypted webhook_secret strings keyed by key id.
 *
 * Cheap (≤20 keys typically, no joins). Called once per webhook hit.
 */
export async function getKeyWebhookSecrets(): Promise<
  { id: string; label: string; webhookSecret: string }[]
> {
  const rows = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      webhookSecretEncrypted: freepikKeys.webhookSecretEncrypted,
    })
    .from(freepikKeys)
    .where(eq(freepikKeys.isActive, true));

  const out: { id: string; label: string; webhookSecret: string }[] = [];
  for (const r of rows) {
    if (!r.webhookSecretEncrypted) continue;
    try {
      const webhookSecret = await decrypt(r.webhookSecretEncrypted);
      out.push({ id: r.id, label: r.label, webhookSecret });
    } catch {
      // decrypt failed — KEY_ENCRYPTION_SECRET rotated for this row;
      // skip silently so the webhook receiver still works for the rest.
    }
  }
  return out;
}
