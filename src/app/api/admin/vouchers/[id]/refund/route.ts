import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { refundRedeemedVoucher } from "@/lib/vouchers/redeem";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/vouchers/[id]/refund
 *
 * Refund a REDEEMED voucher — deducts eur_value from the target
 * activation code's quota_eur (floored at 0) and marks voucher
 * refunded so it cannot be re-redeemed.
 *
 * Body: { reason: string }
 */

const refundSchema = z.object({
  reason: z.string().min(1).max(200),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await parseJsonBody(request);
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: "reason is required.",
      },
      { status: 400 },
    );
  }

  const result = await refundRedeemedVoucher(id, parsed.data.reason);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json(
      {
        ok: false,
        error: result.reason.toUpperCase(),
        message: messageFor(result.reason),
      },
      { status },
    );
  }

  log.info("VOUCHER_REFUNDED", {
    voucherId: id,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ ok: true });
}

function messageFor(reason: string): string {
  switch (reason) {
    case "not_found":
      return "Voucher không tồn tại.";
    case "not_redeemed":
      return "Voucher chưa được redeem — dùng Revoke thay vì Refund.";
    case "already_refunded":
      return "Voucher đã được refund trước đó.";
    case "no_target_code":
      return "Voucher đã redeem nhưng không có activation code đích — kiểm tra DB.";
    default:
      return "Không thể refund voucher.";
  }
}
