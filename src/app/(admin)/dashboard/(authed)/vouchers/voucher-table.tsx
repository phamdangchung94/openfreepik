"use client";

import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  statusOf,
  STATUS_LABEL,
  type VoucherRow,
  type VoucherStatus,
} from "./types";

/**
 * Mobile-friendly voucher list. On md+ uses table; on small screens
 * stacks each row as a card. Action buttons (revoke/refund) are
 * gated by status: only "available" → revoke; only "redeemed" → refund.
 */
export function VoucherTable({
  vouchers,
  onRevoke,
  onRefund,
}: {
  vouchers: VoucherRow[];
  onRevoke: (v: VoucherRow) => void;
  onRefund: (v: VoucherRow) => void;
}) {
  if (vouchers.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        Chưa có voucher nào — bấm <span className="font-medium">Mint vouchers</span> để tạo.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Mobile: stacked cards */}
      <div className="space-y-2 md:hidden">
        {vouchers.map((v) => (
          <VoucherCard
            key={v.id}
            v={v}
            onRevoke={onRevoke}
            onRefund={onRefund}
          />
        ))}
      </div>
      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Redeemed by</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => {
              const status = statusOf(v);
              return (
                <tr
                  key={v.id}
                  className="border-t even:bg-muted/30 hover:bg-muted/50"
                >
                  <td className="px-3 py-2 font-mono text-foreground/80">
                    {v.code}
                  </td>
                  <td className="px-3 py-2">
                    {v.tier} · {v.eurValue} €
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.batchLabel ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {v.redeemedByCodeLabel ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(v.createdAt).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowActions
                      v={v}
                      status={status}
                      onRevoke={onRevoke}
                      onRefund={onRefund}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VoucherCard({
  v,
  onRevoke,
  onRefund,
}: {
  v: VoucherRow;
  onRevoke: (v: VoucherRow) => void;
  onRefund: (v: VoucherRow) => void;
}) {
  const status = statusOf(v);
  return (
    <div className="rounded-md border p-3 text-[12px]">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-foreground/90">{v.code}</div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{v.tier} · {v.eurValue} €</span>
        {v.batchLabel && <span>Batch: {v.batchLabel}</span>}
        {v.redeemedByCodeLabel && (
          <span>Nạp cho: {v.redeemedByCodeLabel}</span>
        )}
        <span>{new Date(v.createdAt).toLocaleDateString("vi-VN")}</span>
      </div>
      <div className="mt-2 flex justify-end">
        <RowActions
          v={v}
          status={status}
          onRevoke={onRevoke}
          onRefund={onRefund}
        />
      </div>
    </div>
  );
}

function RowActions({
  v,
  status,
  onRevoke,
  onRefund,
}: {
  v: VoucherRow;
  status: VoucherStatus;
  onRevoke: (v: VoucherRow) => void;
  onRefund: (v: VoucherRow) => void;
}) {
  if (status === "available") {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => onRevoke(v)}
        title="Huỷ voucher chưa nạp"
      >
        <Ban className="size-3" />
        Revoke
      </Button>
    );
  }
  if (status === "redeemed") {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => onRefund(v)}
        title="Hoàn tiền voucher đã nạp"
      >
        <RotateCcw className="size-3" />
        Refund
      </Button>
    );
  }
  // Revoked or refunded — no actions, terminal states.
  return <span className="text-[11px] text-muted-foreground">—</span>;
}

function StatusBadge({ status }: { status: VoucherStatus }) {
  const variant =
    status === "available"
      ? "outline"
      : status === "redeemed"
        ? "default"
        : status === "refunded"
          ? "secondary"
          : "destructive";
  return (
    <Badge variant={variant} className="text-[10px]">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
