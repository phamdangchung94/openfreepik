"use client";

import { useState } from "react";
import { Volume2, VolumeX, ExternalLink, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatVnd } from "@/lib/format-currency";

export type UsageStatus = "succeeded" | "failed" | "refunded" | "pending";

export interface UsageLogRow {
  id: string;
  createdAt: string;
  codeId: string;
  codeLabel: string | null;
  keyId: string | null;
  keyLabel: string | null;
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: string;
  freepikTaskId: string | null;
  videoUrl: string | null;
  magnificVideoUrl: string | null;
  status: UsageStatus;
  /**
   * Upstream-supplied failure reason for refunded rows. Admin sees the
   * raw verbatim string here; customer-side surfaces (error-log dialog)
   * run it through `friendlyError` for brand-scrub + i18n.
   */
  errorMessage: string | null;
  /**
   * Customer prompt verbatim. Persisted at POST time for admin debug
   * + repeat-failure analysis. Migration 0011.
   */
  prompt: string | null;
}

/**
 * Column ID → header label + render fn. Wide column set so admin can
 * inspect the full row; visibility toggle in the table header lets
 * power users hide what they don't need today (defaults all visible).
 */
type ColId =
  | "when"
  | "customer"
  | "key"
  | "endpoint"
  | "duration"
  | "audio"
  | "tier"
  | "eur"
  | "status"
  | "prompt"
  | "error"
  | "magnific"
  | "r2"
  | "taskId";

const COLUMN_LABEL: Record<ColId, string> = {
  when: "Thời điểm",
  customer: "Khách",
  key: "Key",
  endpoint: "Endpoint",
  duration: "Thời lượng",
  audio: "Audio",
  tier: "Tier",
  eur: "Giá",
  status: "Trạng thái",
  prompt: "Prompt",
  error: "Lý do fail (raw)",
  magnific: "URL gốc",
  r2: "URL CDN",
  taskId: "Task ID",
};

const ALL_COLS: ColId[] = [
  "when",
  "customer",
  "key",
  "endpoint",
  "duration",
  "audio",
  "tier",
  "eur",
  "status",
  "prompt",
  "error",
  "magnific",
  "r2",
  "taskId",
];

// Show every column by default — admin asked for full visibility.
// Power users can hide columns via the "Cột" dropdown.
const DEFAULT_VISIBLE: Set<ColId> = new Set(ALL_COLS);

export function UsageTable({ rows }: { rows: UsageLogRow[] }) {
  const [visible, setVisible] = useState<Set<ColId>>(DEFAULT_VISIBLE);

  function toggleCol(c: ColId) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <ExportCsvButton rows={rows} visible={visible} />
        <ColumnToggle visible={visible} onToggle={toggleCol} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr>
              {ALL_COLS.filter((c) => visible.has(c)).map((c) => (
                <th
                  key={c}
                  className={cn(
                    "px-3 py-2 text-left font-medium",
                    c === "eur" && "text-right",
                  )}
                >
                  {COLUMN_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                {visible.has("when") && (
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                )}
                {visible.has("customer") && (
                  <td
                    className="px-3 py-2 max-w-[180px] truncate"
                    title={r.codeLabel ?? ""}
                  >
                    {r.codeLabel ?? "—"}
                  </td>
                )}
                {visible.has("key") && (
                  <td
                    className="px-3 py-2 max-w-[160px] truncate text-muted-foreground"
                    title={r.keyLabel ?? ""}
                  >
                    {r.keyLabel ?? "—"}
                  </td>
                )}
                {visible.has("endpoint") && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    {renderEndpoint(r.endpoint)}
                  </td>
                )}
                {visible.has("duration") && (
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    {r.durationSeconds ? `${r.durationSeconds}s` : "—"}
                  </td>
                )}
                {visible.has("audio") && (
                  <td className="px-3 py-2">
                    {r.withAudio ? (
                      <Volume2 className="size-3.5 text-foreground" />
                    ) : (
                      <VolumeX className="size-3.5 text-muted-foreground" />
                    )}
                  </td>
                )}
                {visible.has("tier") && (
                  <td className="px-3 py-2">
                    {r.tier ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.tier}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                {visible.has("eur") && (
                  <td
                    className="px-3 py-2 text-right font-mono whitespace-nowrap"
                    title={`${Number(r.costEur).toFixed(2)} EUR (internal)`}
                  >
                    {formatVnd(Number(r.costEur))}
                  </td>
                )}
                {visible.has("status") && (
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                )}
                {visible.has("prompt") && (
                  <td
                    className="px-3 py-2 max-w-[280px] text-[11px]"
                    title={r.prompt ?? ""}
                  >
                    {r.prompt ? (
                      <span className="line-clamp-2 break-words">
                        {r.prompt}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {visible.has("error") && (
                  <td
                    className="px-3 py-2 max-w-[280px] text-[11px] text-muted-foreground"
                    title={r.errorMessage ?? ""}
                  >
                    {r.errorMessage ? (
                      <span className="line-clamp-2 break-all">
                        {r.errorMessage}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                {visible.has("magnific") && (
                  <td className="px-3 py-2">
                    {r.magnificVideoUrl ? (
                      <a
                        href={r.magnificVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        title={r.magnificVideoUrl}
                      >
                        Mở <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {visible.has("r2") && (
                  <td className="px-3 py-2">
                    {r.videoUrl && r.videoUrl !== r.magnificVideoUrl ? (
                      <a
                        href={r.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        title={r.videoUrl}
                      >
                        Mở <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {visible.has("taskId") && (
                  <td
                    className="px-3 py-2 font-mono text-[10px] text-muted-foreground"
                    title={r.freepikTaskId ?? ""}
                  >
                    {r.freepikTaskId ?? "—"}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={ALL_COLS.filter((c) => visible.has(c)).length}
                  className="p-8 text-center text-muted-foreground"
                >
                  Không có log nào khớp filter này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Friendly label for the upstream endpoint column. Older rows are
 * 'kling-v3' or 'improve-prompt' from before WAN/Kling-4K shipped;
 * keep them mapped to their tier-agnostic names.
 */
function renderEndpoint(endpoint: string): string {
  switch (endpoint) {
    case "kling-v3":
      return "Kling 3";
    case "kling-4k-t2v":
      return "Kling 4K T2V";
    case "kling-4k-i2v":
      return "Kling 4K I2V";
    case "wan-v27":
      return "WAN 2.7";
    case "improve-prompt":
      return "Improve";
    default:
      return endpoint;
  }
}

function StatusBadge({ status }: { status: UsageStatus }) {
  const variant: "default" | "secondary" | "destructive" =
    status === "succeeded"
      ? "default"
      : status === "refunded" || status === "pending"
        ? "secondary"
        : "destructive";
  return (
    <Badge variant={variant} className="text-[10px]">
      {status}
    </Badge>
  );
}

function ColumnToggle({
  visible,
  onToggle,
}: {
  visible: Set<ColId>;
  onToggle: (c: ColId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1">
            Cột
            <ChevronDown className="size-3" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-[180px]">
        {ALL_COLS.map((c) => (
          <DropdownMenuItem
            key={c}
            onClick={(e) => {
              // Keep the menu open so admin can toggle several at once.
              e.preventDefault();
              onToggle(c);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span>{COLUMN_LABEL[c]}</span>
            {visible.has(c) && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExportCsvButton({
  rows,
  visible,
}: {
  rows: UsageLogRow[];
  visible: Set<ColId>;
}) {
  function handleExport() {
    if (rows.length === 0) return;
    const cols = ALL_COLS.filter((c) => visible.has(c));
    const header = cols.map((c) => COLUMN_LABEL[c]);
    const lines = rows.map((r) => cols.map((c) => csvCell(r, c)));
    const csv = [header, ...lines]
      .map((row) =>
        row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    // Excel UTF-8 BOM so Vietnamese characters render correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usage-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={rows.length === 0}
    >
      Xuất CSV
    </Button>
  );
}

/** Map a row's column to its CSV cell value (string-safe). */
function csvCell(r: UsageLogRow, col: ColId): string | number {
  switch (col) {
    case "when":
      return r.createdAt;
    case "customer":
      return r.codeLabel ?? "";
    case "key":
      return r.keyLabel ?? "";
    case "endpoint":
      return r.endpoint;
    case "duration":
      return r.durationSeconds ?? "";
    case "audio":
      return r.withAudio ? "yes" : "no";
    case "tier":
      return r.tier ?? "";
    case "eur":
      // CSV export gets the raw VND integer (no formatting) so Excel
      // can sum + filter the column. Admin can recompute EUR by /1000.
      return Math.round(Number(r.costEur) * 1000);
    case "status":
      return r.status;
    case "prompt":
      return r.prompt ?? "";
    case "error":
      return r.errorMessage ?? "";
    case "magnific":
      return r.magnificVideoUrl ?? "";
    case "r2":
      return r.videoUrl ?? "";
    case "taskId":
      return r.freepikTaskId ?? "";
  }
}
