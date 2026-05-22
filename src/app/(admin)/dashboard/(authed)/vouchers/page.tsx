"use client";

import { useCallback, useEffect, useState } from "react";
import { Ticket } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VoucherStatsCard } from "./voucher-stats-card";
import { VoucherTable } from "./voucher-table";
import { BulkCreateVoucherDialog } from "./bulk-create-voucher-dialog";
import {
  RefundVoucherDialog,
  RevokeVoucherDialog,
} from "./voucher-action-dialogs";
import type {
  VoucherRow,
  VoucherStats,
  VoucherTier,
  VouchersResponse,
} from "./types";

/**
 * /dashboard/vouchers — admin landing for top-up vouchers.
 *
 * Layout: stats card → filter row → list → action dialogs.
 *
 * The list re-fetches on:
 *   - mount
 *   - filter change (tier / status)
 *   - successful bulk-mint
 *   - successful revoke / refund
 *
 * We keep the filtered list and stats in separate state because stats
 * always reflect the FULL population (admin needs to see "8/50 used"
 * regardless of filter selection).
 */

type StatusFilter = "all" | "available" | "redeemed" | "revoked" | "refunded";

export default function VouchersPage() {
  const [tierFilter, setTierFilter] = useState<"all" | VoucherTier>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [stats, setStats] = useState<VoucherStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<VoucherRow | null>(null);
  const [refundTarget, setRefundTarget] = useState<VoucherRow | null>(null);

  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tierFilter !== "all") params.set("tier", tierFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("limit", "200");
    try {
      const res = await fetch(`/api/admin/vouchers?${params}`);
      const json = (await res.json()) as VouchersResponse | {
        ok: false;
        message?: string;
      };
      if (!res.ok || !("ok" in json) || !json.ok) {
        toast.error(
          "message" in json && json.message
            ? json.message
            : "Không tải được vouchers",
        );
        return;
      }
      setRows(json.vouchers);
      setStats(json.stats);
    } finally {
      setLoading(false);
    }
  }, [tierFilter, statusFilter]);

  useEffect(() => {
    void fetchVouchers();
  }, [fetchVouchers]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ticket className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Vouchers</h1>
          <span className="text-xs text-muted-foreground">
            Mã nạp tiền cho activation code
          </span>
        </div>
        <BulkCreateVoucherDialog onCreated={fetchVouchers} />
      </header>

      <VoucherStatsCard stats={stats} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Lọc:</span>
        <Select
          value={tierFilter}
          onValueChange={(v) => setTierFilter(v as "all" | VoucherTier)}
        >
          <SelectTrigger size="sm" className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả mệnh giá</SelectItem>
            <SelectItem value="100k">100k</SelectItem>
            <SelectItem value="200k">200k</SelectItem>
            <SelectItem value="500k">500k</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger size="sm" className="h-8 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả status</SelectItem>
            <SelectItem value="available">Còn dùng được</SelectItem>
            <SelectItem value="redeemed">Đã nạp</SelectItem>
            <SelectItem value="revoked">Đã huỷ</SelectItem>
            <SelectItem value="refunded">Đã hoàn</SelectItem>
          </SelectContent>
        </Select>
        {loading && (
          <span className="text-[11px] text-muted-foreground">Đang tải…</span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} hiển thị
        </span>
      </div>

      <VoucherTable
        vouchers={rows}
        onRevoke={setRevokeTarget}
        onRefund={setRefundTarget}
      />

      <RevokeVoucherDialog
        voucher={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onSuccess={fetchVouchers}
      />
      <RefundVoucherDialog
        voucher={refundTarget}
        onClose={() => setRefundTarget(null)}
        onSuccess={fetchVouchers}
      />
    </div>
  );
}
