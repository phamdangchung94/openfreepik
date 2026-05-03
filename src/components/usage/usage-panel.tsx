"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, Calendar, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { getApiHeaders } from "@/lib/api-headers";
import type { ActivationMode } from "@/store/auth-store";

interface UsageResponse {
  balance: {
    mode: ActivationMode;
    label: string | null;
    quotaEur: number | null;
    usedEur: number;
    remainingEur: number | null;
  };
  totals: { videos: number; eur: number };
  today: { videos: number; eur: number };
  recent: Array<{
    id: string;
    createdAt: string;
    endpoint: string;
    tier: "pro" | "std" | null;
    durationSeconds: number | null;
    withAudio: boolean;
    costEur: number;
    freepikTaskId: string | null;
    status: "succeeded" | "failed" | "refunded" | "pending";
  }>;
}

interface UsagePanelProps {
  trigger: React.ReactElement;
}

export function UsagePanel({ trigger }: UsagePanelProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchUsage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", { headers: getApiHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) fetchUsage();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Thống kê sử dụng
            </DialogTitle>
            <Button
              variant="ghost"
              size="xs"
              onClick={fetchUsage}
              disabled={loading}
              title="Làm mới"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!data && loading && (
          <p className="text-xs text-muted-foreground">Đang tải...</p>
        )}

        {data && <UsageContent data={data} />}
      </DialogContent>
    </Dialog>
  );
}

function UsageContent({ data }: { data: UsageResponse }) {
  const { balance, totals, today, recent } = data;
  const pct =
    balance.mode !== "unlimited" &&
    balance.quotaEur !== null &&
    balance.quotaEur > 0
      ? Math.min(100, (balance.usedEur / balance.quotaEur) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Balance section */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">
            {balance.label ?? "Khách hàng"}{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {balance.mode}
            </Badge>
          </span>
          {balance.mode === "unlimited" ? (
            <span className="font-mono text-muted-foreground">
              Đã dùng {balance.usedEur.toFixed(2)} EUR · còn lại ∞
            </span>
          ) : (
            <span className="font-mono">
              {balance.usedEur.toFixed(2)} / {balance.quotaEur?.toFixed(2)} EUR
            </span>
          )}
        </div>
        {balance.mode !== "unlimited" && (
          <Progress value={pct} className="h-1.5" />
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={<Calendar className="size-3.5" />}
          label="Hôm nay (UTC)"
          videos={today.videos}
          eur={today.eur}
        />
        <StatCard
          icon={<Hash className="size-3.5" />}
          label="Tất cả"
          videos={totals.videos}
          eur={totals.eur}
        />
      </div>

      {/* Recent log */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium">Hoạt động gần đây</h3>
        {recent.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            Chưa có hoạt động — tạo video đầu tiên để xem ở đây.
          </p>
        ) : (
          <ScrollArea className="h-[260px] rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Thời gian</th>
                  <th className="px-2 py-1.5 text-left font-medium">Loại</th>
                  <th className="px-2 py-1.5 text-left font-medium">Chất lượng</th>
                  <th className="px-2 py-1.5 text-right font-medium">EUR</th>
                  <th className="px-2 py-1.5 text-left font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.endpoint === "kling-v3" ? "Video" : "Cải thiện"}
                      {r.durationSeconds && (
                        <span className="ml-1 text-muted-foreground">
                          ({r.durationSeconds}s
                          {r.withAudio ? "+audio" : ""})
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{r.tier ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {r.costEur.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  videos,
  eur,
}: {
  icon: React.ReactNode;
  label: string;
  videos: number;
  eur: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums">{videos}</span>
          <span className="text-xs text-muted-foreground">video</span>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {eur.toFixed(2)} EUR
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "succeeded"
      ? "default"
      : status === "refunded"
        ? "secondary"
        : "destructive";
  return (
    <Badge variant={variant} className="text-[10px]">
      {status}
    </Badge>
  );
}
