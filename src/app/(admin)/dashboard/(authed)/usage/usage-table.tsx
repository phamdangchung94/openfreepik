"use client";

import { useEffect, useState } from "react";
import {
  Volume2,
  VolumeX,
  ExternalLink,
  ChevronDown,
  Check,
  ChevronsDown,
} from "lucide-react";
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

/**
 * Initial cap on rows rendered to the DOM. At >100 rows the mobile
 * card list + desktop table both start to lag on touch scroll and
 * filter re-render. We progressively render in chunks — first 100 on
 * mount, +PAGE_SIZE more each time admin taps "Tải thêm". CSV export
 * still operates on the full `rows` array (not the visible slice).
 */
const PAGE_SIZE = 100;

export function UsageTable({ rows }: { rows: UsageLogRow[] }) {
  const [visible, setVisible] = useState<Set<ColId>>(DEFAULT_VISIBLE);
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);

  // Reset progressive render whenever the row set changes (new fetch,
  // filter change, refresh) so admin always starts at the top of a
  // fresh result instead of inheriting a deep scroll from prior data.
  useEffect(() => {
    setRenderLimit(PAGE_SIZE);
  }, [rows]);

  const visibleRows = rows.slice(0, renderLimit);
  const hasMore = renderLimit < rows.length;

  function toggleCol(c: ColId) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function loadMore() {
    setRenderLimit((n) => Math.min(n + PAGE_SIZE, rows.length));
  }

  return (
    <div>
      {/* Column toggle + CSV export — desktop only. Mobile card view
          shows a curated fixed field set so column visibility is moot
          there; CSV download still works from the desktop view. */}
      <div className="mb-2 hidden items-center justify-end gap-2 md:flex">
        <ExportCsvButton rows={rows} visible={visible} />
        <ColumnToggle visible={visible} onToggle={toggleCol} />
      </div>

      {/* Render-count indicator — visible from 100+ so admin knows the
          table is paginated client-side and what's currently in DOM. */}
      {rows.length > PAGE_SIZE && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Đang hiển thị <span className="font-medium text-foreground">{visibleRows.length}</span>
          {" / "}
          <span className="font-medium text-foreground">{rows.length}</span> dòng
          {" — "}
          tải dần để giữ UI mượt. CSV export vẫn lấy toàn bộ.
        </p>
      )}

      {/* ── Mobile (<md): vertical card per log ──────────────── */}
      <div className="space-y-2 md:hidden">
        {visibleRows.map((r) => (
          <UsageMobileCard key={r.id} row={r} />
        ))}
        {rows.length === 0 && (
          <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            Không có log nào khớp filter này.
          </div>
        )}
      </div>

      {/* ── Desktop (md+): full table — progressively rendered ──────── */}
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
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
            {visibleRows.map((r) => (
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

      {/* "Tải thêm" button — shared between mobile + desktop. Adds
          another PAGE_SIZE rows to the visible window per click. Shown
          only when there's actually more to reveal. */}
      {hasMore && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            className="gap-1.5"
          >
            <ChevronsDown className="size-3.5" />
            Tải thêm {Math.min(PAGE_SIZE, rows.length - renderLimit)} dòng
            <span className="text-[10px] text-muted-foreground">
              ({rows.length - renderLimit} còn lại)
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Friendly label for the upstream endpoint column. Older rows are
 * 'kling-v3' or 'improve-prompt' from before WAN/Kling-4K shipped;
 * keep them mapped to their tier-agnostic names.
 */
/**
 * Mobile-only card view for one usage_log row. Curated field set —
 * no column toggle, just the data admin needs at a glance on phone:
 *   - status pill + time-ago
 *   - endpoint · tier · duration · audio
 *   - amount (VND)
 *   - prompt preview (2 lines max, captured by migration 0011)
 *   - customer · key labels
 *   - error_message highlighted when refunded/failed
 *   - collapsible footer for task_id + URLs (debug-only, hidden by
 *     default to keep the card compact)
 */
function UsageMobileCard({ row }: { row: UsageLogRow }) {
  const [open, setOpen] = useState(false);
  const isFailure = row.status === "refunded" || row.status === "failed";
  const endpointLabel = renderEndpoint(row.endpoint);

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs",
        isFailure ? "border-destructive/30 bg-destructive/5" : "bg-card",
      )}
    >
      {/* Row 1: status + time ago */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <StatusBadge status={row.status} />
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={new Date(row.createdAt).toLocaleString()}
        >
          {timeAgoShort(row.createdAt)}
        </span>
      </div>

      {/* Row 2: endpoint + meta chips */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-medium text-foreground">{endpointLabel}</span>
        {row.tier && (
          <Badge variant="secondary" className="text-[10px]">
            {row.tier}
          </Badge>
        )}
        {row.durationSeconds && (
          <span className="font-mono text-muted-foreground">
            {row.durationSeconds}s
          </span>
        )}
        {row.withAudio ? (
          <Volume2 className="size-3 text-muted-foreground" />
        ) : (
          <VolumeX className="size-3 text-muted-foreground/50" />
        )}
        <span
          className="ml-auto font-mono font-medium text-foreground"
          title={`${Number(row.costEur).toFixed(2)} EUR`}
        >
          {formatVnd(Number(row.costEur))}
        </span>
      </div>

      {/* Row 3: prompt preview (if any) */}
      {row.prompt && (
        <p
          className="mb-2 line-clamp-2 break-words text-[11px] text-foreground/80"
          title={row.prompt}
        >
          {row.prompt}
        </p>
      )}

      {/* Row 4: customer · key */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="truncate" title={row.codeLabel ?? ""}>
          {row.codeLabel ?? "(no label)"}
        </span>
        <span>·</span>
        <span className="truncate" title={row.keyLabel ?? ""}>
          {row.keyLabel ?? "(no key)"}
        </span>
      </div>

      {/* Row 5: error message — highlighted */}
      {isFailure && row.errorMessage && (
        <p className="mt-2 line-clamp-2 break-words text-[11px] text-destructive/80">
          ⚠ {row.errorMessage}
        </p>
      )}

      {/* Collapsible debug footer */}
      {(row.freepikTaskId || row.magnificVideoUrl || row.videoUrl) && (
        <div className="mt-2 border-t pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[10px] text-muted-foreground hover:text-foreground"
          >
            <span>Chi tiết</span>
            <ChevronDown
              className={cn("size-3 transition-transform", open && "rotate-180")}
            />
          </button>
          {open && (
            <div className="mt-2 space-y-1.5 text-[10px]">
              {row.freepikTaskId && (
                <div className="font-mono break-all text-muted-foreground">
                  <span className="text-foreground/60">task_id:</span>{" "}
                  {row.freepikTaskId}
                </div>
              )}
              {row.magnificVideoUrl && (
                <a
                  href={row.magnificVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  URL gốc <ExternalLink className="size-3" />
                </a>
              )}
              {row.videoUrl && row.videoUrl !== row.magnificVideoUrl && (
                <a
                  href={row.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-3 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  URL CDN <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Short relative time for tight mobile rows ('2m', '5h', '3d'). */
function timeAgoShort(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

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
    case "kling-motion-v2-6-std":
      return "Motion 2.6 Std";
    case "kling-motion-v2-6-pro":
      return "Motion 2.6 Pro";
    case "kling-motion-v3-std":
      return "Motion 3.0 Std";
    case "kling-motion-v3-pro":
      return "Motion 3.0 Pro";
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
