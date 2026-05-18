"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, RefreshCw, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatVnd, formatVndWithEur } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

interface CodeRow {
  id: string;
  code: string;
  customerLabel: string | null;
  mode: "unlimited" | "quota" | "topup";
  quotaEur: string | null;
  usedEur: string;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
}

interface AggregateRow {
  status: "succeeded" | "failed" | "refunded" | "pending";
  count: number;
  totalEur: string;
}

interface DailyRow {
  day: string;
  tasks: number;
  eur: string;
}

interface RecentTask {
  id: string;
  createdAt: string;
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: string;
  status: "succeeded" | "failed" | "refunded" | "pending";
  errorMessage: string | null;
  prompt: string | null;
  freepikTaskId: string | null;
}

interface ApiResponse {
  ok: true;
  code: CodeRow;
  aggregate: AggregateRow[];
  daily: DailyRow[];
  recent: RecentTask[];
}

/**
 * Per-code drilldown — admin clicks a code label in /dashboard/codes
 * and lands here. Shows:
 *   - Code metadata (mode, quota, used, status, expiry)
 *   - Aggregate counters by status
 *   - 30-day sparkline (daily spend + task count)
 *   - Last 50 tasks (inline log)
 *   - CSV export for the full history
 */
export default function CodeDrilldownPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/codes/${id}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Không tải được");
        return;
      }
      setData(json as ApiResponse);
    } finally {
      setLoading(false);
    }
  }

  async function impersonate() {
    if (
      !confirm(
        "Mở session customer như code này? Mã activation sẽ được copy vào clipboard và mở `/` ở tab mới — paste vào ô kích hoạt. Hành động này được ghi log audit.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/codes/${id}/impersonate`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Impersonate thất bại");
        return;
      }
      // Best-effort clipboard write — if it fails (e.g. browser denies
      // permission), still open the tab so admin can read the code
      // off this page's debug data.
      try {
        await navigator.clipboard.writeText(json.code);
        toast.success(
          `Đã copy mã của "${json.customerLabel ?? "code"}" — paste vào tab mới`,
        );
      } catch {
        toast.warning(
          `Code: ${json.code} (clipboard fail — copy thủ công)`,
          { duration: 10000 },
        );
      }
      window.open("/", "_blank", "noopener");
    } catch (err) {
      toast.error(
        `Impersonate error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Đang tải...</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          href="/dashboard/codes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Codes
        </Link>
        <p className="text-sm text-destructive">{error ?? "Không tải được"}</p>
      </div>
    );
  }

  const { code, aggregate, daily, recent } = data;
  const usedEur = Number(code.usedEur);
  const quotaEur = code.quotaEur ? Number(code.quotaEur) : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/dashboard/codes"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Codes
          </Link>
          <h1 className="truncate text-xl font-semibold sm:text-2xl">
            {code.customerLabel ?? "(chưa đặt tên)"}
          </h1>
          <p className="font-mono text-[10px] text-muted-foreground">
            {code.code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={impersonate}
            disabled={!code.isActive}
            title={
              code.isActive
                ? "Copy code + mở / để paste — log ADMIN_IMPERSONATE_CODE"
                : "Code đang inactive — reactivate trước"
            }
          >
            <UserCheck className="size-3.5" />
            Impersonate
          </Button>
          <a
            href={`/api/admin/codes/${id}/export-csv`}
            download
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-1.5",
            )}
          >
            <Download className="size-3.5" />
            Export CSV
          </a>
        </div>
      </header>

      {/* Metadata strip */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Meta label="Mode" value={<Badge variant="secondary">{code.mode}</Badge>} />
          <Meta
            label="Used / Quota"
            value={
              <span className="font-mono text-sm">
                {formatVndWithEur(usedEur)} /{" "}
                {quotaEur !== null ? formatVndWithEur(quotaEur) : "∞"}
              </span>
            }
          />
          <Meta
            label="Status"
            value={
              <Badge variant={code.isActive ? "default" : "destructive"}>
                {code.isActive ? "active" : "revoked"}
              </Badge>
            }
          />
          <Meta
            label="Hết hạn"
            value={
              <span className="text-sm">
                {code.expiresAt
                  ? new Date(code.expiresAt).toLocaleDateString()
                  : "—"}
              </span>
            }
          />
        </CardContent>
      </Card>

      {/* Status rollup */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-medium">Tổng quan trạng thái</h2>
          {aggregate.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Chưa có task nào.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["succeeded", "failed", "refunded", "pending"] as const).map(
                (status) => {
                  const row = aggregate.find((a) => a.status === status);
                  const count = row?.count ?? 0;
                  const eur = Number(row?.totalEur ?? "0");
                  return (
                    <div
                      key={status}
                      className={cn(
                        "rounded-md border p-3",
                        status === "succeeded" && "border-emerald-500/30 bg-emerald-500/5",
                        status === "failed" && "border-destructive/30 bg-destructive/5",
                        status === "refunded" && "border-amber-500/30 bg-amber-500/5",
                        status === "pending" && "border-muted",
                      )}
                    >
                      <p className="text-[10px] uppercase text-muted-foreground">
                        {status}
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {count}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatVnd(eur)}
                      </p>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 30-day daily bars — text-based sparkline so we don't pull in a
          chart library for one page. Each row shows day + EUR + bar. */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-medium">
            Daily spend (30 ngày gần nhất)
          </h2>
          {daily.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Chưa có dữ liệu 30 ngày.
            </p>
          ) : (
            <DailyBars rows={daily} />
          )}
        </CardContent>
      </Card>

      {/* Recent tasks (last 50) */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-3">
            <h2 className="text-sm font-medium">
              50 tasks gần nhất ({recent.length})
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Cần lịch sử đầy đủ? Bấm <span className="font-medium">Export CSV</span>{" "}
              ở header để tải toàn bộ.
            </p>
          </div>
          {recent.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Code này chưa có task.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Khi</th>
                    <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                    <th className="px-3 py-2 text-left font-medium">Tier</th>
                    <th className="px-3 py-2 text-right font-medium">Giá</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Prompt</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5">{t.endpoint}</td>
                      <td className="px-3 py-1.5">{t.tier ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {formatVnd(Number(t.costEur))}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant={
                            t.status === "succeeded"
                              ? "default"
                              : t.status === "failed" || t.status === "refunded"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {t.status}
                        </Badge>
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-1.5">
                        <span title={t.prompt ?? ""}>
                          {t.prompt ?? <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function DailyBars({ rows }: { rows: DailyRow[] }) {
  // Build a full 30-day window (so days with 0 spend show as gaps)
  // then merge incoming rows by date string.
  const today = new Date();
  const days: Array<{ day: string; tasks: number; eur: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const r = rows.find((x) => x.day === dayStr);
    days.push({
      day: dayStr,
      tasks: r?.tasks ?? 0,
      eur: r ? Number(r.eur) : 0,
    });
  }
  const maxEur = Math.max(...days.map((d) => d.eur), 0.01);
  return (
    <div className="space-y-1">
      {days.map((d) => (
        <div
          key={d.day}
          className="flex items-center gap-2 text-[10px] text-muted-foreground"
        >
          <span className="w-20 font-mono">{d.day}</span>
          <div className="flex flex-1 items-center gap-1">
            <div
              className="h-3 rounded-sm bg-primary/40"
              style={{
                width: `${Math.max((d.eur / maxEur) * 100, d.eur > 0 ? 2 : 0)}%`,
              }}
            />
            <span className="font-mono tabular-nums">
              {d.eur > 0 ? formatVnd(d.eur) : "—"}
            </span>
            {d.tasks > 0 && (
              <span className="ml-auto font-mono tabular-nums">
                {d.tasks} task
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
