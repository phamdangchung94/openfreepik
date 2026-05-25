"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Save, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatVnd } from "@/lib/format-currency";

/**
 * Admin 2-layer pricing editor (migration 0021).
 *
 * Two editable columns:
 *   - "Upstream EUR" — what Magnific actually charges us per request
 *     (4-decimal precision). Admin sets this when Magnific publishes
 *     new rates; never affects what the customer is billed.
 *   - "Customer EUR" — what we charge the customer (2-decimal,
 *     internal credit unit). This is the only number the activation
 *     code balance is decremented by.
 *
 * Derived: "Margin %" = ((customer - upstream) / upstream) × 100.
 * Color-coded so admin can scan unprofitable rows at a glance:
 *   green ≥ 30%, amber 0–30%, red < 0% (loss).
 */

interface PricingRow {
  id: string;
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: string;
  upstreamCostEur: string | null;
}

/** Per-row dirty buffer: separate keys so admin can edit both fields
 * before saving without one wiping the other. */
type DraftMap = Record<string, { cost?: string; upstream?: string }>;

function computeMarginPct(customer: number, upstream: number): number | null {
  if (!Number.isFinite(upstream) || upstream <= 0) return null;
  return ((customer - upstream) / upstream) * 100;
}

function marginClass(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct < 0) return "text-red-600 dark:text-red-400";
  if (pct < 30) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

export default function AdminPricingPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [draft, setDraft] = useState<DraftMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing");
      const json = await res.json();
      if (json.ok) {
        setRows(json.rules);
        setDraft({});
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Persist either/both fields. Skips fields that are unchanged. */
  async function save(id: string) {
    const d = draft[id];
    if (!d) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    const payload: { costEur?: number; upstreamCostEur?: number } = {};
    if (d.cost !== undefined && d.cost !== row.costEur) {
      const cost = Number(d.cost);
      if (!Number.isFinite(cost) || cost < 0) {
        toast.error("Customer EUR không hợp lệ");
        return;
      }
      payload.costEur = cost;
    }
    if (
      d.upstream !== undefined &&
      d.upstream !== (row.upstreamCostEur ?? "")
    ) {
      const upstream = Number(d.upstream);
      if (!Number.isFinite(upstream) || upstream < 0) {
        toast.error("Upstream EUR không hợp lệ");
        return;
      }
      payload.upstreamCostEur = upstream;
    }
    if (Object.keys(payload).length === 0) return;

    setSaving(id);
    try {
      const res = await fetch(`/api/admin/pricing/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("Save failed");
      } else {
        toast.success("Đã cập nhật");
        await load();
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Pricing rules</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            <strong>Upstream EUR</strong> = giá thật Magnific charge.{" "}
            <strong>Customer EUR</strong> = giá khách hàng trả (internal
            credit, ~1000 VND/EUR). Margin = (Customer − Upstream) / Upstream.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-3 py-2 text-left font-medium">Tier</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Audio</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Upstream EUR
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Customer EUR
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    VND khách
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Margin</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draft[r.id] ?? {};
                  const costStr = d.cost ?? r.costEur;
                  const upstreamStr = d.upstream ?? (r.upstreamCostEur ?? "");
                  const cost = Number(costStr) || 0;
                  const upstream = Number(upstreamStr) || 0;
                  const marginPct = computeMarginPct(cost, upstream);
                  const dirty =
                    (d.cost !== undefined && d.cost !== r.costEur) ||
                    (d.upstream !== undefined &&
                      d.upstream !== (r.upstreamCostEur ?? ""));
                  return (
                    <tr
                      key={r.id}
                      className="border-t even:bg-muted/30 hover:bg-muted/50"
                    >
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.endpoint}
                      </td>
                      <td className="px-3 py-2">
                        {r.tier ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {r.tier}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.durationSeconds ? `${r.durationSeconds}s` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.withAudio ? (
                          <Volume2 className="size-3.5 text-foreground" />
                        ) : (
                          <VolumeX className="size-3.5 text-muted-foreground" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={upstreamStr}
                          onChange={(e) =>
                            setDraft((m) => ({
                              ...m,
                              [r.id]: { ...m[r.id], upstream: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              save(r.id);
                            }
                          }}
                          className="ml-auto h-7 w-24 text-right font-mono text-xs"
                          placeholder="—"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={costStr}
                          onChange={(e) =>
                            setDraft((m) => ({
                              ...m,
                              [r.id]: { ...m[r.id], cost: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              save(r.id);
                            }
                          }}
                          className="ml-auto h-7 w-24 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-muted-foreground">
                        {formatVnd(cost)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono text-[11px] ${marginClass(marginPct)}`}
                      >
                        {marginPct === null ? "—" : `${marginPct.toFixed(0)}%`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant={dirty ? "default" : "ghost"}
                          size="xs"
                          disabled={!dirty || saving === r.id}
                          onClick={() => save(r.id)}
                        >
                          {saving === r.id ? "..." : <Save className="size-3" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && !loading && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Chưa có pricing rule. Chạy `pnpm db:seed-pricing`.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
