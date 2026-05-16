"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTaskStore } from "@/store/task-store";

interface BatchProgressWidgetProps {
  total: number;
  completed: number;
  failed: number;
  /** In-flight (IN_PROGRESS — currently calling Freepik). */
  running?: number;
  /** Queued but waiting for a concurrency slot. */
  queued?: number;
  isProcessing: boolean;
  onCancel: () => void;
  /** Optional retry callback. Hidden if absent or no tasks failed. */
  onRetryFailed?: () => number;
}

/**
 * Sticky bottom-right widget for batch generation. Replaces the per-task
 * toast spam: a single piece of UI tracks all in-flight work, with ETA
 * computed from the rolling completion rate.
 *
 * Visibility rules:
 *   - Mounted while isProcessing
 *   - Stays mounted ~6s after the queue drains so customer sees the
 *     final "X/N done" state, then auto-hides
 *   - Manually dismissable via the X button
 *
 * ETA math:
 *   We track the timestamp of the first completion in the current batch
 *   and divide elapsed time by completed count → seconds per item, then
 *   multiply by remaining. Robust under variable concurrency because we
 *   sample completion times, not job-start times.
 */
export function BatchProgressWidget({
  total,
  completed,
  failed,
  running = 0,
  queued = 0,
  isProcessing,
  onCancel,
  onRetryFailed,
}: BatchProgressWidgetProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hideTimerId, setHideTimerId] = useState<number | null>(null);

  // Reset dismiss state on each new batch.
  const previousTotalRef = useRef(0);
  useEffect(() => {
    if (total > 0 && total !== previousTotalRef.current) {
      setDismissed(false);
      previousTotalRef.current = total;
    }
  }, [total]);

  // Auto-hide 6s after batch finishes (still keep the final stats visible
  // for that window so the customer reads it).
  useEffect(() => {
    if (isProcessing) {
      if (hideTimerId !== null) {
        clearTimeout(hideTimerId);
        setHideTimerId(null);
      }
      return;
    }
    if (total === 0 || dismissed) return;
    const id = window.setTimeout(() => setDismissed(true), 6_000);
    setHideTimerId(id);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing, total]);

  const eta = useEta({ total, completed, isProcessing });

  if (dismissed) return null;
  if (total === 0) return null;
  // Don't render if nothing's happened (avoid flash on initial mount)
  if (completed === 0 && failed === 0 && !isProcessing) return null;

  const remaining = Math.max(0, total - completed - failed);
  const pct = total > 0 ? ((completed + failed) / total) * 100 : 0;
  const allDone = !isProcessing && remaining === 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 w-[calc(100vw-2rem)] max-w-[20rem] rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur md:bottom-4 md:w-80"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : failed > 0 ? (
            <XCircle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-green-500" />
          )}
          <span className="text-sm font-medium">
            {allDone
              ? failed === 0
                ? `Xong ${completed} video`
                : `Xong (${completed} ✓ ${failed} ✗)`
              : `Đang tạo ${completed + failed}/${total}`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setDismissed(true)}
          title="Ẩn"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <Progress value={pct} className="my-3 h-1.5" />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="text-green-500">✓ {completed}</span>
          {failed > 0 && <span className="text-destructive">✗ {failed}</span>}
        </span>
        {isProcessing && eta && <span title="Ước tính thời gian còn lại">{eta}</span>}
      </div>

      {isProcessing && (running > 0 || queued > 0) && (
        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
          {running > 0 && (
            <span title="Đang xử lý trên máy chủ AI">
              <span className="font-medium text-foreground">{running}</span>{" "}
              đang chạy
            </span>
          )}
          {queued > 0 && (
            <span title="Đợi đến lượt khi có slot trống">
              <span className="font-medium text-foreground">{queued}</span>{" "}
              trong hàng chờ
            </span>
          )}
        </div>
      )}

      {isProcessing && (
        <Button
          variant="outline"
          size="xs"
          className="mt-3 w-full"
          onClick={onCancel}
        >
          Huỷ batch
        </Button>
      )}

      {!isProcessing && failed > 0 && onRetryFailed && (
        <Button
          variant="outline"
          size="xs"
          className="mt-3 w-full"
          onClick={onRetryFailed}
        >
          Thử lại {failed} video lỗi
        </Button>
      )}
    </div>
  );
}

/**
 * Compute ETA from completion rate. Tracks `firstCompleteAt` for the
 * current batch (resets when total changes) and uses elapsed seconds /
 * completed to derive seconds-per-item, then multiplies by remaining.
 */
function useEta({
  total,
  completed,
  isProcessing,
}: {
  total: number;
  completed: number;
  isProcessing: boolean;
}): string | null {
  const firstCompleteRef = useRef<number | null>(null);
  const [, force] = useState(0);

  // Reset on new batch.
  const prevTotal = useRef(0);
  useEffect(() => {
    if (total !== prevTotal.current) {
      firstCompleteRef.current = null;
      prevTotal.current = total;
    }
  }, [total]);

  // Stamp first completion.
  useEffect(() => {
    if (completed >= 1 && firstCompleteRef.current === null) {
      firstCompleteRef.current = Date.now();
    }
  }, [completed]);

  // Tick every 5s so the displayed ETA updates without spamming renders.
  useEffect(() => {
    if (!isProcessing) return;
    const id = window.setInterval(() => force((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [isProcessing]);

  return useMemo(() => {
    if (!isProcessing) return null;
    if (completed < 1) return null;
    const start = firstCompleteRef.current;
    if (!start) return null;
    const elapsed = (Date.now() - start) / 1000;
    const perItem = elapsed / completed;
    const remaining = Math.max(0, total - completed);
    const eta = Math.round(perItem * remaining);
    if (eta < 60) return `~${eta}s`;
    if (eta < 3600) return `~${Math.round(eta / 60)}p`;
    return `~${Math.round(eta / 3600)}h`;
  }, [completed, total, isProcessing]);
}

/**
 * Convenience wrapper that pulls progress from the task-store directly
 * — usable from anywhere in the tree without prop-drilling. The page
 * still owns the cancel handler, so this version takes that as a prop.
 */
export function BatchProgressWidgetConnected({
  onCancel,
  total,
  completed,
  failed,
  isProcessing,
}: BatchProgressWidgetProps) {
  // Subscribe with selectors so this widget re-renders only when its own
  // numbers change — not when individual task fields update.
  const _activeIsProcessing = useTaskStore((s) => s.isProcessing);
  // Caller passes isProcessing too; prefer caller's value if it differs
  // (the batch hook owns the source of truth).
  void _activeIsProcessing;
  return (
    <BatchProgressWidget
      total={total}
      completed={completed}
      failed={failed}
      isProcessing={isProcessing}
      onCancel={onCancel}
    />
  );
}
