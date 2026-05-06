"use client";

import { memo } from "react";
import { Check, CheckCircle2, Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/preview/status-badge";
import { UrlCountdown } from "@/components/preview/url-countdown";
import { cn } from "@/lib/utils";
import { safeMediaUrl } from "@/lib/url-allowlist";
import type { GenerationTask } from "@/store/task-store";

interface HistoryItemProps {
  task: GenerationTask;
  isActive: boolean;
  /** Whether the parent is in multi-select mode. */
  selectMode?: boolean;
  /** True only for completed-with-still-valid-URL rows. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onClick: () => void;
  onDelete: () => void;
}

/**
 * Compact time-ago for the sidebar — Vietnamese long forms ("18 phút
 * trước") wrap onto 2-3 lines on narrow screens. Single-letter unit
 * keeps the meta row at one line; full label sits in the title attr
 * for the curious. Pattern matches Twitter / GitHub.
 */
function timeAgoCompact(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}p`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Long form for the tooltip — accessible read on hover. */
function timeAgoLong(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "vừa xong";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

/**
 * Wrapped in React.memo with a custom equality so a 100-task history
 * doesn't re-render every row on each store tick. We compare the bits
 * that actually change the rendered output — primitives off `task` plus
 * the selection/active flags. Function props (`onClick` etc.) are
 * deliberately ignored: the parent recreates them per render but they
 * always close over the same id so the visible behaviour is unchanged.
 */
function HistoryItemImpl({
  task,
  isActive,
  selectMode = false,
  selectable = false,
  selected = false,
  onToggleSelect,
  onClick,
  onDelete,
}: HistoryItemProps) {
  const safeThumb = task.mode === "i2v" ? safeMediaUrl(task.imageUrl) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={cn(
        "group relative flex gap-3 rounded-lg border p-2 transition-colors cursor-pointer hover:bg-muted/50",
        isActive
          ? "border-primary bg-primary/5"
          : "border-transparent hover:border-border",
        selectMode && !selectable && "opacity-50 cursor-not-allowed",
        selected && "border-primary bg-primary/10",
      )}
    >
      {/* Selection checkbox — visible only in select mode. */}
      {selectMode && (
        <div
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 bg-background",
            !selectable && "opacity-30",
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (selectable && onToggleSelect) onToggleSelect();
          }}
          aria-label={selected ? "Bỏ chọn" : "Chọn"}
        >
          {selected && <Check className="size-3" />}
        </div>
      )}

      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        {safeThumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={safeThumb}
            alt="Source"
            className="size-9 rounded-md object-cover"
          />
        ) : (
          <Video className="size-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Single-line prompt — long Vietnamese stays on one row, full
            text in the title tooltip for accessibility. Vastly more
            videos visible per scroll than the old 2-line clamp. */}
        <p
          className="truncate text-sm leading-snug"
          title={task.prompt || undefined}
        >
          {task.prompt || "Video chưa đặt tên"}
        </p>
        {/* Compact meta row — never wraps. Status dot + age + download
            check + countdown all on one line using single-letter units. */}
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <StatusBadge status={task.status} className="scale-90 origin-left" />
          <span title={timeAgoLong(task.createdAt)}>
            {timeAgoCompact(task.createdAt)}
          </span>
          {task.status === "COMPLETED" && task.downloadedAt && (
            <span
              className="inline-flex items-center gap-0.5 text-green-500"
              title={`Đã tải lúc ${new Date(task.downloadedAt).toLocaleString()}`}
            >
              <CheckCircle2 className="size-3" />
            </span>
          )}
          {task.status === "COMPLETED" && task.videoUrlExpiresAt && (
            <span className="ml-auto">
              <UrlCountdown expiresAt={task.videoUrlExpiresAt} compact />
            </span>
          )}
        </div>
      </div>

      {!selectMode && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

export const HistoryItem = memo(HistoryItemImpl, (prev, next) => {
  // The set of fields the row actually paints with. If any of these differ,
  // re-render. Otherwise skip — even though the parent passes a fresh
  // `task` reference and new arrow-function callbacks each tick, the
  // rendered DOM is identical.
  const a = prev.task;
  const b = next.task;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.prompt === b.prompt &&
    a.videoUrl === b.videoUrl &&
    a.videoUrlExpiresAt === b.videoUrlExpiresAt &&
    a.downloadedAt === b.downloadedAt &&
    a.imageUrl === b.imageUrl &&
    a.mode === b.mode &&
    a.tier === b.tier &&
    a.createdAt === b.createdAt &&
    prev.isActive === next.isActive &&
    prev.selectMode === next.selectMode &&
    prev.selectable === next.selectable &&
    prev.selected === next.selected
  );
});
