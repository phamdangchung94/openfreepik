"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { useRegenerateHandler } from "@/store/regenerate-handler-store";
import { ErrorLogDialog } from "./error-log-dialog";

/**
 * Header trigger for the error log dialog. The badge shows count of
 * un-acknowledged failures in the last 24 hours — keeps the indicator
 * relevant without permanently lighting up after a one-off bad day.
 *
 * No props: regenerate is wired via the page-level handler registered
 * in useRegenerateHandler. If the customer hits "Tạo lại" before the
 * page has registered (race during route transition), we fall back to
 * a no-op rather than crashing.
 */
export function ErrorLogButton() {
  const tasks = useTaskStore((s) => s.tasks);
  const handler = useRegenerateHandler((s) => s.handler);

  const unreadCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Object.values(tasks).filter(
      (t) =>
        (t.status === "FAILED" ||
          t.status === "TIMEOUT" ||
          t.status === "CANCELLED") &&
        t.createdAt >= cutoff &&
        !t.errorAcknowledgedAt,
    ).length;
  }, [tasks]);

  function handleRegenerate(task: GenerationTask) {
    handler?.(task);
  }

  return (
    <ErrorLogDialog
      onRegenerate={handleRegenerate}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="relative gap-1.5"
          title={
            unreadCount > 0
              ? `Có ${unreadCount} video lỗi chưa xem`
              : "Xem nhật ký lỗi"
          }
        >
          <AlertCircle className="size-3.5" />
          <span className="hidden sm:inline">Lỗi</span>
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      }
    />
  );
}
