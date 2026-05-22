import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { revokeUnredeemedVoucher } from "@/lib/vouchers/redeem";
import { log } from "@/lib/logger";

/**
 * PATCH /api/admin/vouchers/[id]/revoke
 *
 * Soft-deletes an UNREDEEMED voucher so the redemption endpoint rejects
 * future attempts. Used when admin mis-mints, loses a physical card, or
 * a batch is compromised.
 *
 * For voucher that's already REDEEMED, use /[id]/refund instead.
 *
 * Body: { reason: string }
 */

const revokeSchema = z.object({
  reason: z.string().min(1).max(200),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await parseJsonBody(request);
  const parsed = revokeSchema.safeParse(body);
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

  const result = await revokeUnredeemedVoucher(id, parsed.data.reason);
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_redeemed"
          ? 409
          : 409;
    return NextResponse.json(
      {
        ok: false,
        error: result.reason.toUpperCase(),
        message: messageFor(result.reason),
      },
      { status },
    );
  }

  log.info("VOUCHER_REVOKED", {
    voucherId: id,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ ok: true });
}

function messageFor(reason: string): string {
  switch (reason) {
    case "not_found":
      return "Voucher không tồn tại.";
    case "already_redeemed":
      return "Voucher đã được redeem — dùng Refund thay vì Revoke.";
    case "already_revoked":
      return "Voucher đã bị revoke trước đó.";
    default:
      return "Không thể revoke voucher.";
  }
}
