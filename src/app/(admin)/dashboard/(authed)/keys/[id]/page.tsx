"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Activity,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatVnd, formatVndWithEur } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

interface KeyMeta {
  id: string;
  label: string;
  assignedEur: string;
  usedEur: string;
  isActive: boolean;
  pausedUntil: string | null;
  maxConcurrent: number;
  notes: string | null;
  createdAt: string;
  lastUsedAt: string | null;
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
  failures: number;
}

interface ErrorRow {
  id: string;
  createdAt: string;
  endpoint: string;
  status: string;
  errorMessage: string | null;
  freepikTaskId: string | null;
}

interface ApiResponse {
  ok: true;
  key: KeyMeta;
  aggregate: AggregateRow[];
  daily: DailyRow[];
  inflight: number;
  recentErrors: ErrorRow[];
}

/**
 * Per-key health drilldown — admin clicks a key in /dashboard/keys
 * and lands here for: 30-day spend trend, daily failure rate, current
 * in-flight count vs max_concurrent, and last 10 errors. Helps answer
 * "is this key worth keeping?" / "why are customers failing on this one?".
 */
export default function KeyHealthPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/keys/${id}/health`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Không tải được");
        return;
      }
      setData(json as ApiResponse);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="p-4 text-sm text-muted-foreground sm:p-6">
        Đang tải...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        <Link
          href="/dashboard/keys"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Keys
        </Link>
        <p className="text-sm text-destructive">{error ?? "Không tải được"}</p>
      </div>
    );
  }

  const { key, aggregate, daily, inflight, recentErrors } = data;
  const used = Number(key.usedEur);
  const assigned = Number(key.assignedEur);
  const remaining = Math.max(assigned - used, 0);
  const usedPct = assigned > 0 ? (used / assigned) * 100 : 0;
  const totalTasks = aggregate.reduce((sum, a) => sum + a.count, 0);
  const failures = aggregate
    .filter((a) => a.status === "failed" || a.status === "refunded")
    .reduce((sum, a) => sum + a.count, 0);
  const failureRate = totalTasks > 0 ? (failures / totalTasks) * 100 : 0;
  const concurrencyPct = (inflight / key.maxConcurrent) * 100;
  const pausedActive =
    key.pausedUntil && new Date(key.pausedUntil) > new Date();

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/dashboard/keys"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Keys
          </Link>
          <h1 className="truncate text-xl font-semibold sm:text-2xl">
            {key.label}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={key.isActive ? "default" : "destructive"}>
              {key.isActive ? "active" : "inactive"}
            </Badge>
            {pausedActive && (
              <Badge variant="outline" className="text-amber-600">
                <Pause className="mr-1 size-3" />
                Paused đến{" "}
                {new Date(key.pausedUntil as string).toLocaleString()}
              </Badge>
            )}
            {key.notes && (
              <span className="text-xs text-muted-foreground">
                · {key.notes}
              </span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Quota"
          value={`${usedPct.toFixed(1)}%`}
          subtitle={`${formatVndWithEur(used)} / ${formatVndWithEur(assigned)}`}
          accent={usedPct > 80 ? "warn" : usedPct > 95 ? "critical" : "ok"}
        />
        <Kpi
          label="Còn lại"
          value={formatVnd(remaining)}
          subtitle={`${remaining.toFixed(2)} EUR`}
          accent={remaining < 30 ? "critical" : remaining < 100 ? "warn" : "ok"}
        />
        <Kpi
          label="30-day failure"
          value={`${failureRate.toFixed(1)}%`}
          subtitle={`${failures} / ${totalTasks} tasks`}
          accent={failureRate > 20 ? "critical" : failureRate > 10 ? "warn" : "ok"}
        />
        <Kpi
          label="In-flight"
          value={String(inflight)}
          subtitle={`max ${key.maxConcurrent}`}
          accent={
            concurrencyPct > 90 ? "warn" : concurrencyPct > 100 ? "critical" : "ok"
          }
        />
      </div>

      {/* Quota progress bar */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">Spend tracking</span>
            <span className="font-mono text-muted-foreground">
              {formatVndWithEur(used)} / {formatVndWithEur(assigned)}
            </span>
          </div>
          <Progress value={usedPct} className="h-2" />
          <p className="text-[10px] text-muted-foreground">
            Last used:{" "}
            {key.lastUsedAt
              ? new Date(key.lastUsedAt).toLocaleString()
              : "never"}
          </p>
        </CardContent>
      </Card>

      {/* Status rollup */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-medium">30-day rollup</h2>
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
                      status === "succeeded" &&
                        "border-emerald-500/30 bg-emerald-500/5",
                      status === "failed" &&
                        "border-destructive/30 bg-destructive/5",
                      status === "refunded" &&
                        "border-amber-500/30 bg-amber-500/5",
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
        </CardContent>
      </Card>

      {/* Daily series with failure rate */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-medium">
            Daily 30 ngày — tasks + failure rate
          </h2>
          {daily.length === 0 ? (
            <p className="text-xs text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <DailyBars rows={daily} />
          )}
        </CardContent>
      </Card>

      {/* Last 10 errors */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-3">
            <h2 className="text-sm font-medium">
              10 lỗi gần nhất ({recentErrors.length})
            </h2>
          </div>
          {recentErrors.length === 0 ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Không có lỗi 30 ngày qua.
            </div>
          ) : (
            <ul className="divide-y">
              {recentErrors.map((e) => (
                <li key={e.id} className="space-y-1 p-3 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertCircle className="size-3 text-destructive" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                    <Badge variant="destructive" className="text-[10px]">
                      {e.status}
                    </Badge>
                    <span className="text-foreground/80">{e.endpoint}</span>
                  </div>
                  {e.errorMessage && (
                    <p
                      className="line-clamp-2 break-words text-destructive/80"
                      title={e.errorMessage}
                    >
                      {e.errorMessage}
                    </p>
                  )}
                  {e.freepikTaskId && (
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      task_id: {e.freepikTaskId}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle: string;
  accent: "ok" | "warn" | "critical";
}) {
  const accentClass =
    accent === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : accent === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "";
  return (
    <Card className={accentClass}>
      <CardContent className="p-3">
        <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function DailyBars({ rows }: { rows: DailyRow[] }) {
  const today = new Date();
  const days: Array<{
    day: string;
    tasks: number;
    eur: number;
    failures: number;
    failureRate: number;
  }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const r = rows.find((x) => x.day === dayStr);
    const tasks = r?.tasks ?? 0;
    const failures = r?.failures ?? 0;
    days.push({
      day: dayStr,
      tasks,
      eur: r ? Number(r.eur) : 0,
      failures,
      failureRate: tasks > 0 ? (failures / tasks) * 100 : 0,
    });
  }
  const maxTasks = Math.max(...days.map((d) => d.tasks), 1);
  return (
    <div className="space-y-1">
      {days.map((d) => (
        <div
          key={d.day}
          className="flex items-center gap-2 text-[10px] text-muted-foreground"
        >
          <span className="w-20 font-mono">{d.day}</span>
          <div className="flex flex-1 items-center gap-1.5">
            <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-muted">
              {/* Stacked bar: succeeded (green) + failed (red) */}
              <div
                className="bg-emerald-500/60"
                style={{
                  width: `${((d.tasks - d.failures) / maxTasks) * 100}%`,
                }}
                title={`${d.tasks - d.failures} succeeded`}
              />
              <div
                className="bg-destructive/60"
                style={{ width: `${(d.failures / maxTasks) * 100}%` }}
                title={`${d.failures} failed/refunded`}
              />
            </div>
            <span className="w-12 text-right font-mono tabular-nums">
              {d.tasks > 0 ? `${d.tasks}` : "—"}
            </span>
            {d.tasks > 0 && d.failureRate > 0 && (
              <span
                className={cn(
                  "w-10 text-right font-mono tabular-nums",
                  d.failureRate > 20 && "text-destructive",
                  d.failureRate > 50 && "font-semibold",
                )}
                title={`${d.failureRate.toFixed(1)}% failure`}
              >
                {d.failureRate.toFixed(0)}%
              </span>
            )}
            {d.eur > 0 && (
              <span className="w-16 text-right font-mono tabular-nums">
                {formatVnd(d.eur)}
              </span>
            )}
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-emerald-500/60" />
          succeeded
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-destructive/60" />
          failed/refunded
        </span>
        <Activity className="ml-auto size-3" />
      </div>
    </div>
  );
}
