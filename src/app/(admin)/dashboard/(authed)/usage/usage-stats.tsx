"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, CalendarDays, Hash, TrendingUp } from "lucide-react";
import { formatVnd } from "@/lib/format-currency";

interface SummaryResponse {
  ok: boolean;
  byTier: Array<{ tier: string | null; videos: number; eur: number }>;
  byCustomer: Array<{
    codeId: string;
    label: string | null;
    videos: number;
    eur: number;
  }>;
  byDay: Array<{ day: string; videos: number; eur: number }>;
  totals: {
    all: { videos: number; eur: number };
    today: { videos: number; eur: number };
    week: { videos: number; eur: number };
  } | null;
}

/**
 * Aggregate stats panel above the usage table — answers the four
 * questions admin asks every morning:
 *   1. How much did we spend today?
 *   2. Last 7 days?
 *   3. Who's the top customer?
 *   4. What's the std/pro split?
 *
 * Data refreshes when the parent calls onLoaded() — that's typically
 * driven by the Refresh button in the page header so stats and table
 * stay in sync.
 */
export function UsageStats({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/usage/summary");
        const json = (await res.json()) as SummaryResponse;
        if (!cancelled && json.ok) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data) {
    return (
      <div className="text-xs text-muted-foreground">
        {loading ? "Đang tải số liệu..." : "Không có dữ liệu."}
      </div>
    );
  }

  const totals = data.totals;
  const topCustomer = data.byCustomer[0];
  const tierMap = Object.fromEntries(data.byTier.map((t) => [t.tier ?? "—", t]));
  const stdEur = tierMap.std?.eur ?? 0;
  const proEur = tierMap.pro?.eur ?? 0;
  const tierTotal = stdEur + proEur;
  const proPct = tierTotal > 0 ? (proEur / tierTotal) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Headline KPIs — 4 cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard
          icon={<Calendar className="size-3.5" />}
          label="Hôm nay"
          videos={totals?.today.videos ?? 0}
          eur={totals?.today.eur ?? 0}
        />
        <KpiCard
          icon={<CalendarDays className="size-3.5" />}
          label="7 ngày qua"
          videos={totals?.week.videos ?? 0}
          eur={totals?.week.eur ?? 0}
        />
        <KpiCard
          icon={<Hash className="size-3.5" />}
          label="Tất cả thời gian"
          videos={totals?.all.videos ?? 0}
          eur={totals?.all.eur ?? 0}
        />
        <KpiCard
          icon={<TrendingUp className="size-3.5" />}
          label="Khách top"
          videos={topCustomer?.videos ?? 0}
          eur={topCustomer?.eur ?? 0}
          subtitle={topCustomer?.label ?? "—"}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {/* Tier split — pro/std percentage bar */}
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Tỷ lệ chi tiêu theo chất lượng
            </h3>
            {tierTotal === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có dữ liệu</p>
            ) : (
              <>
                <div className="flex h-5 overflow-hidden rounded">
                  <div
                    className="bg-primary"
                    style={{ width: `${proPct}%` }}
                    title={`Pro: ${formatVnd(proEur)} (${proEur.toFixed(2)} EUR)`}
                  />
                  <div
                    className="bg-secondary"
                    style={{ width: `${100 - proPct}%` }}
                    title={`Std: ${formatVnd(stdEur)} (${stdEur.toFixed(2)} EUR)`}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px]">
                  <span>
                    Pro <span className="font-mono">{formatVnd(proEur)}</span>
                    <span className="ml-1 text-muted-foreground">
                      ({proPct.toFixed(0)}%)
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Std{" "}
                    <span className="font-mono">{formatVnd(stdEur)}</span>
                    <span className="ml-1">({(100 - proPct).toFixed(0)}%)</span>
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Top 5 customers */}
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              Top 5 khách chi tiêu nhiều nhất
            </h3>
            {data.byCustomer.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có dữ liệu</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {data.byCustomer.slice(0, 5).map((c) => (
                  <li
                    key={c.codeId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate" title={c.label ?? ""}>
                      {c.label ?? "(không nhãn)"}
                    </span>
                    <span
                      className="shrink-0 font-mono text-muted-foreground"
                      title={`${c.eur.toFixed(2)} EUR (internal)`}
                    >
                      {formatVnd(c.eur)} · {c.videos}v
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily spend bar chart — 14 days */}
      <Card>
        <CardContent className="p-3">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            Chi tiêu theo ngày (14 ngày gần nhất)
          </h3>
          <DailyBarChart data={data.byDay} />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  videos,
  eur,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  videos: number;
  eur: number;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-2xl font-bold tabular-nums">{videos}</span>
          <span className="text-xs text-muted-foreground">video</span>
        </div>
        <div
          className="font-mono text-[11px] text-muted-foreground"
          title={`${eur.toFixed(2)} EUR (internal)`}
        >
          {formatVnd(eur)}
        </div>
        {subtitle && (
          <div className="truncate text-[10px] text-muted-foreground/80">
            {subtitle}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyBarChart({
  data,
}: {
  data: Array<{ day: string; eur: number }>;
}) {
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">Chưa có dữ liệu</p>;
  }
  const max = Math.max(...data.map((d) => d.eur), 1);
  return (
    <div className="flex h-24 items-end gap-1">
      {data.map((d) => {
        const h = (d.eur / max) * 100;
        return (
          <div
            key={d.day}
            className="group flex flex-1 flex-col items-center gap-1"
            title={`${d.day}: ${formatVnd(d.eur)} (${d.eur.toFixed(2)} EUR)`}
          >
            <div
              className="w-full rounded-sm bg-primary/60 transition-colors group-hover:bg-primary"
              style={{ height: `${Math.max(h, 2)}%` }}
            />
            <span className="text-[9px] text-muted-foreground">
              {d.day.slice(8, 10)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
