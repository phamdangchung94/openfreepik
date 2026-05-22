"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { VoucherStats } from "./types";

/**
 * Voucher.vnd_value is already a raw VND integer (100000/200000/500000).
 * We don't run it through formatVnd because that helper expects EUR
 * input. Compact form: 1,500,000 → "1.5tr" so the stat fits in the card.
 */
function formatVndCompact(vnd: number): string {
  if (vnd >= 1_000_000_000) return `${(vnd / 1_000_000_000).toFixed(1)}tỷ`;
  if (vnd >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)}tr`;
  if (vnd >= 1_000) return `${(vnd / 1_000).toFixed(0)}k`;
  return vnd.toLocaleString("vi-VN");
}

/**
 * Top-of-page stats card — shows population totals across all vouchers
 * regardless of which filter is active. Helps admin see at-a-glance
 * how much EUR has been credited out + how many vouchers remain in
 * circulation.
 */
export function VoucherStatsCard({ stats }: { stats: VoucherStats | null }) {
  if (!stats) {
    return (
      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          Đang tải số liệu…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-2 py-3 md:grid-cols-6">
        <Stat label="Tổng mint" value={stats.total.toLocaleString("vi-VN")} />
        <Stat
          label="Còn dùng được"
          value={stats.available.toLocaleString("vi-VN")}
          tone="emerald"
        />
        <Stat
          label="Đã nạp"
          value={stats.redeemed.toLocaleString("vi-VN")}
          tone="blue"
        />
        <Stat
          label="Đã huỷ / hoàn"
          value={(stats.revoked + stats.refunded).toLocaleString("vi-VN")}
          tone="muted"
        />
        <Stat
          label="VND đã in"
          value={formatVndCompact(stats.totalVndIssued)}
        />
        <Stat
          label="EUR đã cấp"
          value={`${stats.totalEurCredited.toLocaleString("vi-VN", {
            maximumFractionDigits: 2,
          })} €`}
          tone="blue"
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "blue" | "muted";
}) {
  const colorClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "blue"
        ? "text-blue-600 dark:text-blue-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-sm font-medium ${colorClass}`}>{value}</p>
    </div>
  );
}
