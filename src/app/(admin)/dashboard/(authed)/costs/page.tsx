"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatVnd, formatVndWithEur } from "@/lib/format-currency";
import { cn } from "@/lib/utils";

type Severity = "ok" | "warn" | "critical";

interface KeyForecast {
  id: string;
  label: string;
  isActive: boolean;
  pausedActive: boolean;
  assignedEur: number;
  usedEur: number;
  remainingEur: number;
  burn7dEur: number;
  dailyBurnEur: number;
  daysLeft: number;
  severity: Severity;
}

interface PoolForecast {
  activeKeyCount: number;
  totalRemainingEur: number;
  totalDailyBurnEur: number;
  daysLeft: number;
  severity: Severity;
}

interface ApiResponse {
  ok: true;
  perKey: KeyForecast[];
  pool: PoolForecast;
}

/**
 * Cost dashboard — Freepik EUR forecast.
 *
 * Single-page view: pool aggregate at top, per-key breakdown below.
 * Color-coded by severity (ok / warn / critical) matching the
 * Telegram alert thresholds in /api/admin/costs/forecast.
 */
export default function CostsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/costs/forecast");
      const json = await res.json();
      if (json.ok) setData(json as ApiResponse);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="p-4 text-sm text-muted-foreground sm:p-6">
        Đang tải...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4 text-sm text-destructive sm:p-6">
        Không tải được forecast.
      </div>
    );
  }

  const { pool, perKey } = data;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Cost forecast</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Freepik upstream EUR burn rate + dự báo ngày cạn. Vercel /
            Neon / R2 không track ở đây — Pro tier không có quota cứng
            đáng lo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw
            className={`size-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </header>

      {/* Pool aggregate — the hero card */}
      <PoolCard pool={pool} />

      {/* Per-key breakdown */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">
          Per-key ({perKey.length} key{perKey.length === 1 ? "" : "s"})
        </h2>
        {perKey.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Chưa có key nào.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {perKey
              // Sort: critical first, then warn, then ok — surface
              // most urgent keys at the top of the list.
              .slice()
              .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
              .map((k) => (
                <KeyForecastCard key={k.id} forecast={k} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PoolCard({ pool }: { pool: PoolForecast }) {
  const accent = severityClasses(pool.severity);
  return (
    <Card className={cn("border-2", accent.border)}>
      <CardContent className={cn("space-y-3 p-4", accent.bg)}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Wallet className="size-4" />
              <h2 className="text-sm font-medium">Tổng pool</h2>
              <SeverityBadge severity={pool.severity} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {pool.activeKeyCount} active key
              {pool.activeKeyCount === 1 ? "" : "s"} đang phục vụ
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase text-muted-foreground">
              Còn lại
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatVnd(pool.totalRemainingEur)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {pool.totalRemainingEur.toFixed(2)} EUR
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">
              Burn / ngày (avg 7d)
            </p>
            <p className="text-base font-semibold tabular-nums">
              {formatVnd(pool.totalDailyBurnEur)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {pool.totalDailyBurnEur.toFixed(2)} EUR/ngày
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">
              Dự kiến cạn
            </p>
            <p className="text-base font-semibold tabular-nums">
              {pool.daysLeft >= 999
                ? "—"
                : pool.daysLeft === 0
                  ? "Đã cạn"
                  : `${pool.daysLeft} ngày`}
            </p>
            {pool.daysLeft < 999 && pool.daysLeft > 0 && (
              <p className="text-[10px] text-muted-foreground">
                ~{new Date(Date.now() + pool.daysLeft * 86_400_000).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        {pool.severity !== "ok" && (
          <RecommendedAction severity={pool.severity} />
        )}
      </CardContent>
    </Card>
  );
}

function KeyForecastCard({ forecast }: { forecast: KeyForecast }) {
  const accent = severityClasses(forecast.severity);
  const usedPct =
    forecast.assignedEur > 0
      ? (forecast.usedEur / forecast.assignedEur) * 100
      : 0;
  return (
    <Card className={cn(accent.border)}>
      <CardContent className={cn("space-y-2 p-3", accent.bg)}>
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/dashboard/keys/${forecast.id}`}
            className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium hover:text-primary hover:underline"
          >
            {forecast.label}
            <ExternalLink className="size-3 opacity-50" />
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            {!forecast.isActive && (
              <Badge variant="secondary" className="text-[10px]">
                inactive
              </Badge>
            )}
            {forecast.pausedActive && (
              <Badge variant="outline" className="text-[10px] text-amber-600">
                paused
              </Badge>
            )}
            <SeverityBadge severity={forecast.severity} />
          </div>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Còn lại</span>
          <span className="font-mono tabular-nums">
            {formatVndWithEur(forecast.remainingEur)} / {formatVndWithEur(forecast.assignedEur)}
          </span>
        </div>
        <Progress value={usedPct} className="h-1.5" />
        <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] text-muted-foreground">
          <div>
            <span className="block text-[9px] uppercase">Burn 7d</span>
            <span className="font-mono tabular-nums">
              {formatVnd(forecast.burn7dEur)} ({forecast.dailyBurnEur.toFixed(2)}€/d)
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] uppercase">Cạn sau</span>
            <span className="font-mono tabular-nums">
              {forecast.daysLeft >= 999
                ? "—"
                : forecast.daysLeft === 0
                  ? "đã cạn"
                  : `${forecast.daysLeft} ngày`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendedAction({ severity }: { severity: Severity }) {
  if (severity === "critical") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
        <strong>Hành động ngay:</strong> top up Magnific upstream hoặc
        thêm key mới. Pool sắp/đã cạn — customer sẽ bị 503.
      </div>
    );
  }
  if (severity === "warn") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
        <strong>Lưu ý:</strong> còn dưới 100 EUR hoặc burn rate cao —
        lên lịch top up trong vài ngày tới để tránh outage.
      </div>
    );
  }
  return null;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === "critical") {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <AlertOctagon className="size-3" />
        critical
      </Badge>
    );
  }
  if (severity === "warn") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle className="size-3" />
        warn
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 className="size-3" />
      ok
    </Badge>
  );
}

function severityClasses(s: Severity) {
  if (s === "critical")
    return {
      border: "border-destructive/40",
      bg: "",
    };
  if (s === "warn")
    return {
      border: "border-amber-500/40",
      bg: "",
    };
  return { border: "", bg: "" };
}

function severityWeight(s: Severity): number {
  return s === "critical" ? 3 : s === "warn" ? 2 : 1;
}
