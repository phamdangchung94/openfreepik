"use client";

import { useMemo, useState } from "react";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileNowPlayingBarProps {
  /**
   * Tapping the bar should swap the visible mobile tab to "preview"
   * (and set the active task to the bar's current task). The page owns
   * mobileTab state, so we expose it via callback.
   */
  onOpen: () => void;
  /**
   * Hide the bar when the user is already looking at the preview tab —
   * no point doubling up the same info. Also hidden on desktop via the
   * containing element (md:hidden), so this prop only handles the
   * mobile-tab-visibility case.
   */
  hidden?: boolean;
}

/**
 * "Now playing" mini bar — floats just above the bottom tab nav on
 * mobile, showing the most relevant in-flight or recently-completed
 * task at a glance. Tap anywhere on the bar to jump to Xem tab.
 *
 * Selection priority:
 *   1. Active running task (status QUEUED/CREATED/IN_PROGRESS), most recent first
 *   2. Most recently-completed task within the last 10 min
 *   3. Most recent failed/timeout task within the last 5 min
 *   4. Nothing → bar hides
 */
export function MobileNowPlayingBar({ onOpen, hidden }: MobileNowPlayingBarProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);

  // Dismiss state — keyed by `${taskId}::${status}` so that when the
  // same task transitions to a new state (e.g. IN_PROGRESS → COMPLETED),
  // the bar re-appears with the new status. Dismissals don't persist
  // across reloads — a fresh visit shows the bar again.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const candidate = useMemo(() => pickCandidate(tasks, activeTaskId), [tasks, activeTaskId]);

  if (!candidate || hidden) return null;

  const dismissKey = `${candidate.id}::${candidate.status}`;
  if (dismissed.has(dismissKey)) return null;

  const handleClick = () => {
    // Make sure the preview panel shows THIS task when the customer
    // taps the bar (active task may have been stale).
    setActiveTaskId(candidate.id);
    onOpen();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    // Don't bubble to the bar's main click — the user wants to hide,
    // not open the preview.
    e.stopPropagation();
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(dismissKey);
      return next;
    });
  };

  return (
    <div
      // Sits between content and the bottom tab nav (bottom = nav height +
      // safe-area inset). Hidden on md+ — desktop has the full preview
      // pane visible already. Outer is a <div> (not <button>) so we can
      // nest the dismiss <button> without invalid HTML.
      className="fixed inset-x-0 z-30 mx-3 mb-2 flex items-center gap-2 rounded-xl border bg-card/95 shadow-lg backdrop-blur md:hidden"
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl px-3 py-2 text-left transition-colors hover:bg-muted/40"
        aria-label="Mở chi tiết video"
      >
        <NowPlayingMedia task={candidate} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium leading-tight text-foreground">
            <NowPlayingHeadline task={candidate} />
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {candidate.prompt || "Không có prompt"}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        // Compact tap target (~36px) — large enough on touch but doesn't
        // dominate the bar visually. Vertical separator gives a clear
        // boundary between "open" and "dismiss" affordances.
        className="flex h-11 items-center justify-center rounded-r-xl border-l px-3 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        aria-label="Ẩn thông báo"
        title="Ẩn"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function pickCandidate(
  tasks: Record<string, GenerationTask>,
  activeTaskId: string | null,
): GenerationTask | null {
  const all = Object.values(tasks);
  if (all.length === 0) return null;

  const now = Date.now();
  const running = all
    .filter(
      (t) =>
        t.status === "QUEUED" ||
        t.status === "CREATED" ||
        t.status === "IN_PROGRESS",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (running.length > 0) {
    // Prefer the currently-active task if it's running — keeps the bar
    // stable when multiple tasks are in flight.
    const active = activeTaskId ? tasks[activeTaskId] : null;
    if (
      active &&
      (active.status === "QUEUED" ||
        active.status === "CREATED" ||
        active.status === "IN_PROGRESS")
    ) {
      return active;
    }
    return running[0] ?? null;
  }

  // Recently completed (10 min window).
  const completed = all
    .filter((t) => t.status === "COMPLETED" && now - t.updatedAt < 10 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (completed[0]) return completed[0];

  // Recently failed (5 min window) — surface so customer sees the bad
  // news without hunting for it. Acknowledged errors don't qualify.
  const failed = all
    .filter(
      (t) =>
        (t.status === "FAILED" || t.status === "TIMEOUT") &&
        !t.errorAcknowledgedAt &&
        now - t.updatedAt < 5 * 60_000,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (failed[0]) return failed[0];

  return null;
}

function NowPlayingMedia({ task }: { task: GenerationTask }) {
  // Square thumb (~48x48) so the bar height stays consistent regardless
  // of task aspect ratio.
  const wrapClasses =
    "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted";

  if (task.status === "COMPLETED" && task.thumbnailUrl) {
    return (
      <div className={wrapClasses}>
        {/* Plain <img> intentional — thumbnails are R2 short-lived URLs,
            Next/Image would need explicit remote-pattern config. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={task.thumbnailUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
          <CheckCircle2 className="size-4" />
        </span>
      </div>
    );
  }
  if (task.status === "FAILED" || task.status === "TIMEOUT") {
    return (
      <div className={cn(wrapClasses, "bg-destructive/15 text-destructive")}>
        <AlertCircle className="size-5" />
      </div>
    );
  }
  if (task.status === "QUEUED") {
    return (
      <div className={cn(wrapClasses, "text-amber-500")}>
        <Loader2 className="size-5 animate-spin [animation-duration:1.6s]" />
      </div>
    );
  }
  // CREATED / IN_PROGRESS / fallback.
  return (
    <div className={cn(wrapClasses, "text-primary")}>
      {task.thumbnailUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={task.thumbnailUrl}
            alt=""
            className="size-full object-cover opacity-60"
            loading="lazy"
          />
          <Loader2 className="absolute size-5 animate-spin" />
        </>
      ) : (
        <Loader2 className="size-5 animate-spin" />
      )}
    </div>
  );
}

function NowPlayingHeadline({ task }: { task: GenerationTask }) {
  switch (task.status) {
    case "QUEUED":
      return <>Đang xếp hàng…</>;
    case "CREATED":
    case "IN_PROGRESS":
      return <>Đang tạo video…</>;
    case "COMPLETED":
      return <>Video đã xong — bấm để xem</>;
    case "FAILED":
      return <span className="text-destructive">Tạo video thất bại</span>;
    case "TIMEOUT":
      return <span className="text-destructive">Quá thời gian</span>;
    default:
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Video className="size-3.5" /> Video
        </span>
      );
  }
}
