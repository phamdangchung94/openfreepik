/**
 * Shared types between the voucher admin page + its child components.
 * Keep this file thin — only the wire-format from /api/admin/vouchers.
 */

export type VoucherTier = "100k" | "200k" | "500k";

export type VoucherStatus =
  | "available"
  | "redeemed"
  | "revoked"
  | "refunded";

export interface VoucherRow {
  id: string;
  code: string;
  tier: VoucherTier;
  vndValue: number;
  /** numeric returns as string from drizzle's neon-http driver */
  eurValue: string;
  batchLabel: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  redeemedAt: string | null;
  redeemedByCodeId: string | null;
  redeemedByCodeLabel: string | null;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface VoucherStats {
  total: number;
  available: number;
  redeemed: number;
  revoked: number;
  refunded: number;
  totalVndIssued: number;
  totalEurCredited: number;
}

export interface VouchersResponse {
  ok: true;
  vouchers: VoucherRow[];
  stats: VoucherStats;
}

/** Derive the human-facing status from a row's nullable timestamp fields. */
export function statusOf(row: VoucherRow): VoucherStatus {
  if (row.refundedAt) return "refunded";
  if (row.revokedAt) return "revoked";
  if (row.redeemedAt) return "redeemed";
  return "available";
}

export const STATUS_LABEL: Record<VoucherStatus, string> = {
  available: "Còn dùng được",
  redeemed: "Đã nạp",
  revoked: "Đã huỷ",
  refunded: "Đã hoàn",
};
