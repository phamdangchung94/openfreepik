/**
 * Voucher redemption — atomic single-use credit to activation code balance.
 *
 * Transaction order is critical:
 *   1. UPDATE vouchers SET redeemed_at = NOW(), redeemed_by_code_id = $codeId
 *      WHERE code = $voucher AND redeemed_at IS NULL AND revoked_at IS NULL
 *      RETURNING eur_value
 *   2. UPDATE activation_codes SET quota_eur = COALESCE(quota_eur, 0) + $eur
 *      WHERE id = $codeId AND is_active = true AND mode != 'unlimited'
 *
 * If (1) returns 0 rows → voucher invalid/already-used/revoked → reject
 * with a generic message (anti-bruteforce: don't leak which state).
 *
 * If (2) returns 0 rows mid-transaction → activation code disappeared or
 * went inactive after the route's preflight validateCode. Throw → tx
 * rolls back step (1) → voucher reverts to claimable. Customer can retry.
 *
 * Race: two concurrent redemption attempts of the same voucher both
 * pass the route's pre-check but Postgres serializes the UPDATEs → only
 * one returns a row, the other gets 0 rows and we reject.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, vouchers, type Voucher } from "@/lib/db/schema";

export type RedeemFailureReason =
  | "invalid_or_used" // voucher not found OR redeemed OR revoked (don't leak which)
  | "code_inactive" // activation code went inactive between preflight and tx
  | "code_unlimited"; // tried to redeem on unlimited-mode code

export type RedeemResult =
  | {
      ok: true;
      voucher: Voucher;
      /** New `quotaEur` after credit applied. */
      newQuotaEur: number;
      /** Current `usedEur` (unchanged but returned for client display). */
      newUsedEur: number;
    }
  | { ok: false; reason: RedeemFailureReason };

/**
 * Atomic redeem. Caller must have already validated the activation code
 * via `validateCode` (bearer auth) — this function only enforces the
 * voucher side + a defensive re-check of mode/is_active.
 *
 * @param normalizedVoucherCode — output of `normalizeVoucherCode`
 * @param codeId — the activation code's UUID (from validateCode metadata)
 */
export async function redeemVoucher(
  normalizedVoucherCode: string,
  codeId: string,
): Promise<RedeemResult> {
  return await db.transaction(async (tx) => {
    // Step 1: atomic flip of the voucher's claim state.
    const voucherRows = await tx
      .update(vouchers)
      .set({
        redeemedAt: sql`NOW()`,
        redeemedByCodeId: codeId,
      })
      .where(
        and(
          eq(vouchers.code, normalizedVoucherCode),
          isNull(vouchers.redeemedAt),
          isNull(vouchers.revokedAt),
        ),
      )
      .returning();

    const voucher = voucherRows[0];
    if (!voucher) return { ok: false, reason: "invalid_or_used" };

    // Step 2: credit the activation code. The mode check excludes
    // 'unlimited' codes — they don't track balance, so crediting is
    // meaningless. Route already pre-rejects this case but defense in
    // depth: if it slipped through, rollback the voucher claim.
    const codeRows = await tx
      .update(activationCodes)
      .set({
        quotaEur: sql`COALESCE(${activationCodes.quotaEur}, 0) + ${voucher.eurValue}`,
      })
      .where(
        and(
          eq(activationCodes.id, codeId),
          eq(activationCodes.isActive, true),
          sql`${activationCodes.mode} != 'unlimited'`,
        ),
      )
      .returning();

    const codeRow = codeRows[0];
    if (!codeRow) {
      // Throwing rolls back step 1 — voucher returns to claimable
      // state. Customer can retry once admin re-activates the code,
      // or admin can revoke + re-issue the voucher.
      throw new RedeemRollbackError(
        codeId,
        "Activation code unavailable mid-redemption (inactive or unlimited mode)",
      );
    }

    return {
      ok: true,
      voucher,
      newQuotaEur: Number(codeRow.quotaEur ?? 0),
      newUsedEur: Number(codeRow.usedEur),
    };
  });
}

/**
 * Thrown when step-2 fails inside the redeem transaction; tx auto-
 * rolls-back step 1. Caller (route handler) catches and converts to a
 * 409 with a friendly Vietnamese message.
 */
export class RedeemRollbackError extends Error {
  constructor(
    public readonly codeId: string,
    message: string,
  ) {
    super(message);
    this.name = "RedeemRollbackError";
  }
}

/**
 * Admin-driven refund of a previously redeemed voucher.
 *
 * Inverse of redeem: deducts eur_value from quota_eur (floored at 0
 * to avoid negative quotas — would break the >= check in chargeCode)
 * and flags voucher.refunded_at so it cannot be re-redeemed.
 *
 * Used when a customer disputes a redemption (e.g., voucher mis-sent,
 * mis-applied to wrong code). Idempotent — calling twice is a no-op.
 */
export type RefundFailureReason =
  | "not_found"
  | "not_redeemed"
  | "already_refunded"
  | "no_target_code"; // voucher was redeemed but redeemed_by_code_id is NULL (DB inconsistency)

export type RefundResult =
  | { ok: true }
  | { ok: false; reason: RefundFailureReason };

export async function refundRedeemedVoucher(
  voucherId: string,
  reason: string,
): Promise<RefundResult> {
  return await db.transaction(async (tx) => {
    const [voucher] = await tx
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, voucherId))
      .limit(1);

    if (!voucher) return { ok: false, reason: "not_found" };
    if (!voucher.redeemedAt) return { ok: false, reason: "not_redeemed" };
    if (voucher.refundedAt) return { ok: false, reason: "already_refunded" };
    if (!voucher.redeemedByCodeId) {
      return { ok: false, reason: "no_target_code" };
    }

    await tx
      .update(vouchers)
      .set({
        refundedAt: sql`NOW()`,
        refundReason: reason,
      })
      .where(eq(vouchers.id, voucherId));

    await tx
      .update(activationCodes)
      .set({
        quotaEur: sql`GREATEST(COALESCE(${activationCodes.quotaEur}, 0) - ${voucher.eurValue}, 0)`,
      })
      .where(eq(activationCodes.id, voucher.redeemedByCodeId));

    return { ok: true };
  });
}

/**
 * Admin-driven revoke of an UNREDEEMED voucher. Sets revoked_at so the
 * redemption endpoint rejects future attempts. No-op if already redeemed
 * (use refundRedeemedVoucher for that case).
 */
export type RevokeFailureReason =
  | "not_found"
  | "already_redeemed"
  | "already_revoked";

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: RevokeFailureReason };

export async function revokeUnredeemedVoucher(
  voucherId: string,
  reason: string,
): Promise<RevokeResult> {
  const [voucher] = await db
    .select()
    .from(vouchers)
    .where(eq(vouchers.id, voucherId))
    .limit(1);

  if (!voucher) return { ok: false, reason: "not_found" };
  if (voucher.redeemedAt) return { ok: false, reason: "already_redeemed" };
  if (voucher.revokedAt) return { ok: false, reason: "already_revoked" };

  await db
    .update(vouchers)
    .set({
      revokedAt: sql`NOW()`,
      revokeReason: reason,
    })
    .where(eq(vouchers.id, voucherId));

  return { ok: true };
}
