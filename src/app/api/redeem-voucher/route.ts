import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { vouchers } from "@/lib/db/schema";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { validateCode } from "@/lib/auth/activation";
import { checkRateLimit } from "@/lib/rate-limit";
import { redeemVoucher, RedeemRollbackError } from "@/lib/vouchers/redeem";
import {
  maskVoucherCode,
  normalizeVoucherCode,
  parseVoucherCode,
} from "@/lib/vouchers/format";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/redeem-voucher
 *
 * Returns the last 10 vouchers redeemed by the authenticated activation
 * code. Used by the customer-side Claim Code dialog to show "Lịch sử
 * nạp" — receipts, mostly. Read-only, no rate limit needed.
 *
 * Voucher code is masked (`CODE-100-***MPQR`) in the response — the
 * raw redeemed code is not actionable by the customer anymore but
 * leaking it to a stolen-session attacker buys them nothing useful
 * either way. Mask is a defensive minor anyway.
 */
export async function GET(request: Request) {
  const bearer = extractActivationCode(request);
  if (!bearer) {
    return NextResponse.json(
      { ok: false, error: "AUTH", message: "Cần kích hoạt code trước." },
      { status: 401 },
    );
  }
  const validation = await validateCode(bearer);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: "AUTH", message: "Code đã dùng/đã hết hạn." },
      { status: 401 },
    );
  }

  const rows = await db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      tier: vouchers.tier,
      vndValue: vouchers.vndValue,
      eurValue: vouchers.eurValue,
      redeemedAt: vouchers.redeemedAt,
      refundedAt: vouchers.refundedAt,
    })
    .from(vouchers)
    .where(eq(vouchers.redeemedByCodeId, validation.metadata.codeId))
    .orderBy(desc(vouchers.redeemedAt))
    .limit(10);

  return NextResponse.json({
    ok: true,
    history: rows.map((r) => ({
      id: r.id,
      maskedCode: maskVoucherCode(r.code),
      tier: r.tier,
      vndValue: r.vndValue,
      eurValue: Number(r.eurValue),
      redeemedAt: r.redeemedAt,
      refundedAt: r.refundedAt,
    })),
  });
}

/**
 * POST /api/redeem-voucher
 *
 * Body: { code: "CODE-100-X4K9MPQR" }
 * Header: Authorization: Bearer <activation_code>
 *
 * Anti-bruteforce design:
 *   - 10 attempts / hour / activation code (the natural unit of abuse —
 *     attacker has to validate against SOME code; rate-limit-by-code
 *     forces them to roll many codes which are themselves rate-limited
 *     to mint at admin's discretion)
 *   - Generic "Mã không hợp lệ hoặc đã dùng" — never leaks whether the
 *     code exists, is revoked, or has been redeemed
 *   - Shape pre-check (parseVoucherCode) saves a DB roundtrip on
 *     obviously-bad input AND keeps the rate-limit budget for real
 *     attempts
 *
 * Activation code state checks (these DO leak which state, intentionally,
 * because the customer needs actionable info — the bearer is THEIR code):
 *   - unlimited mode → "Mã này không cần nạp"
 *   - inactive → "Code đã dùng/đã hết hạn"
 *   - expired → "Code đã dùng/đã hết hạn"
 */

const REDEEM_RATE_LIMIT = 10;
const REDEEM_RATE_WINDOW_SEC = 3_600;

const bodySchema = z.object({
  code: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  // 1. Activation code auth (bearer)
  const bearer = extractActivationCode(request);
  if (!bearer) {
    return NextResponse.json(
      { ok: false, error: "AUTH", message: "Cần kích hoạt code trước." },
      { status: 401 },
    );
  }

  const validation = await validateCode(bearer);
  if (!validation.ok) {
    // Don't leak whether the bearer is wrong vs the code has been
    // disabled — both are 401 with the same message.
    return NextResponse.json(
      {
        ok: false,
        error: "AUTH",
        message: "Code đã dùng/đã hết hạn.",
      },
      { status: 401 },
    );
  }

  // Activation code must be in a state that ACCEPTS top-ups.
  // 'unlimited' codes don't track balance → reject (UX: clear message).
  if (validation.metadata.mode === "unlimited") {
    return NextResponse.json(
      {
        ok: false,
        error: "CODE_UNLIMITED",
        message: "Mã này không cần nạp.",
      },
      { status: 409 },
    );
  }

  // 2. Rate limit per activation code
  const rl = await checkRateLimit({
    resource: "redeem-voucher",
    scope: validation.metadata.codeId,
    limit: REDEEM_RATE_LIMIT,
    windowSeconds: REDEEM_RATE_WINDOW_SEC,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT",
        message: `Thử lại sau ${rl.retryAfterSeconds}s — quá nhiều lần nhập mã.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  // 3. Parse body
  const body = await parseJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: "Mã không hợp lệ.",
      },
      { status: 400 },
    );
  }

  // 4. Shape validation (cheap, no DB) — both shortcuts the
  //    obvious-typo path and saves rate-limit budget for real attempts.
  const normalized = normalizeVoucherCode(parsed.data.code);
  const tier = parseVoucherCode(normalized);
  if (!tier) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_CODE",
        message: "Mã không hợp lệ hoặc đã dùng.",
      },
      { status: 400 },
    );
  }

  // 5. Atomic redemption
  let result;
  try {
    result = await redeemVoucher(normalized, validation.metadata.codeId);
  } catch (err) {
    if (err instanceof RedeemRollbackError) {
      log.warn("VOUCHER_REDEEM_ROLLBACK", {
        codeId: validation.metadata.codeId,
        voucherCode: maskVoucherCode(normalized),
        ...errFields(err),
      });
      return NextResponse.json(
        {
          ok: false,
          error: "CODE_UNAVAILABLE",
          message: "Code đã dùng/đã hết hạn.",
        },
        { status: 409 },
      );
    }
    log.error("VOUCHER_REDEEM_ERROR", {
      codeId: validation.metadata.codeId,
      voucherCode: maskVoucherCode(normalized),
      ...errFields(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL",
        message: "Lỗi hệ thống — thử lại sau.",
      },
      { status: 500 },
    );
  }

  if (!result.ok) {
    // Generic message — same wording regardless of which subcase
    // (not_found / already redeemed / revoked) so brute force can't
    // distinguish a "real but used" code from a "doesn't exist" code.
    log.info("VOUCHER_REDEEM_REJECTED", {
      codeId: validation.metadata.codeId,
      voucherCode: maskVoucherCode(normalized),
      reason: result.reason,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_CODE",
        message: "Mã không hợp lệ hoặc đã dùng.",
      },
      { status: 409 },
    );
  }

  log.info("VOUCHER_REDEEMED", {
    codeId: validation.metadata.codeId,
    voucherId: result.voucher.id,
    voucherCode: maskVoucherCode(normalized),
    tier: result.voucher.tier,
    eurValue: Number(result.voucher.eurValue),
    newQuotaEur: result.newQuotaEur,
  });

  return NextResponse.json({
    ok: true,
    tier: result.voucher.tier,
    vndValue: result.voucher.vndValue,
    eurValue: Number(result.voucher.eurValue),
    balance: {
      mode: validation.metadata.mode,
      quotaEur: result.newQuotaEur,
      usedEur: result.newUsedEur,
      remainingEur: result.newQuotaEur - result.newUsedEur,
    },
  });
}
