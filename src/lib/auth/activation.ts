/**
 * Activation code lifecycle: validate → charge → refund.
 *
 * The code itself is the bearer token sent in `Authorization: Bearer <code>`.
 * Charges and refunds are atomic via SQL (no read-modify-write race window).
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes } from "@/lib/db/schema";

export type ActivationMode = "unlimited" | "quota" | "topup";

export interface CodeMetadata {
  codeId: string;
  label: string | null;
  mode: ActivationMode;
  quotaEur: number | null;
  usedEur: number;
  /** quota_eur - used_eur, or null for unlimited mode */
  remainingEur: number | null;
  expiresAt: Date | null;
}

export type ValidationFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "inactive" }
  | { ok: false; reason: "expired" };

export type ValidationSuccess = { ok: true; metadata: CodeMetadata };

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Look up an activation code and return its current state.
 * Performs no charging — use chargeCode() for that.
 */
export async function validateCode(code: string): Promise<ValidationResult> {
  if (!code || code.length < 8) return { ok: false, reason: "not_found" };

  const rows = await db
    .select()
    .from(activationCodes)
    .where(eq(activationCodes.code, code))
    .limit(1);

  const [row] = rows;
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.isActive) return { ok: false, reason: "inactive" };
  // Drizzle's neon-http driver returns timestamptz as ISO strings, not
  // Date. Calling .getTime() on a string throws TypeError and bubbles
  // up as a 500 to the customer. Normalise to ms either way.
  if (row.expiresAt) {
    const expiresMs =
      row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : Date.parse(String(row.expiresAt));
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
  }

  return { ok: true, metadata: toMetadata(row) };
}

/**
 * Atomically deduct cost from a code's balance.
 * Returns the updated metadata on success, or null if the code is
 * inactive/expired or has insufficient balance.
 *
 * Race-safe: the WHERE clause checks balance and the UPDATE is one
 * statement, so two concurrent charges can't both succeed past the limit.
 */
export async function chargeCode(
  codeId: string,
  costEur: number,
): Promise<CodeMetadata | null> {
  if (costEur < 0) throw new Error("costEur must be >= 0");
  if (costEur === 0) {
    // Free endpoints (e.g., improve-prompt) — just validate without charging.
    const [row] = await db
      .select()
      .from(activationCodes)
      .where(eq(activationCodes.id, codeId))
      .limit(1);
    if (!row || !row.isActive) return null;
    return toMetadata(row);
  }

  const cost = costEur.toFixed(2);

  const rows = await db
    .update(activationCodes)
    .set({ usedEur: sql`${activationCodes.usedEur} + ${cost}` })
    .where(
      and(
        eq(activationCodes.id, codeId),
        eq(activationCodes.isActive, true),
        or(
          eq(activationCodes.mode, "unlimited"),
          sql`${activationCodes.quotaEur} - ${activationCodes.usedEur} >= ${cost}`,
        ),
        or(
          isNull(activationCodes.expiresAt),
          sql`${activationCodes.expiresAt} > now()`,
        ),
      ),
    )
    .returning();

  const [row] = rows;
  if (!row) return null;
  return toMetadata(row);
}

/**
 * Reverse a previous charge. Used when the downstream Freepik call fails
 * after the code has been charged. Always succeeds (no balance check).
 */
export async function refundCode(
  codeId: string,
  costEur: number,
): Promise<void> {
  if (costEur <= 0) return;
  const cost = costEur.toFixed(2);

  await db
    .update(activationCodes)
    .set({
      usedEur: sql`GREATEST(${activationCodes.usedEur} - ${cost}, 0)`,
    })
    .where(eq(activationCodes.id, codeId));
}

function toMetadata(row: typeof activationCodes.$inferSelect): CodeMetadata {
  const quota = row.quotaEur === null ? null : Number(row.quotaEur);
  const used = Number(row.usedEur);
  const remaining =
    row.mode === "unlimited" || quota === null ? null : quota - used;

  // Normalise neon-http's ISO-string timestamps into Date so downstream
  // consumers can rely on the typed `Date | null` shape.
  let expiresAt: Date | null = null;
  if (row.expiresAt) {
    expiresAt =
      row.expiresAt instanceof Date
        ? row.expiresAt
        : new Date(String(row.expiresAt));
  }

  return {
    codeId: row.id,
    label: row.customerLabel,
    mode: row.mode as ActivationMode,
    quotaEur: quota,
    usedEur: used,
    remainingEur: remaining,
    expiresAt,
  };
}
