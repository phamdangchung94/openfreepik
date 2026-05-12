"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  RotateCcw,
  Trash2,
  CheckCheck,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { friendlyError } from "@/lib/error-messages";

interface ErrorLogDialogProps {
  trigger: React.ReactElement;
  onRegenerate: (task: GenerationTask) => void;
}

/**
 * Centralized error log for the customer.
 *
 * Aggregates every FAILED / TIMEOUT / CANCELLED task into a single
 * panel with the prompt, friendly Vietnamese error message, key params,
 * and an inline "Tạo lại" button.
 *
 * Acknowledgment model: each task has `errorAcknowledgedAt`. The header
 * button's red dot counts only tasks WITHOUT a timestamp — opening the
 * dialog or clicking "Đánh dấu tất cả đã xem" clears the dot.
 *
 * Filters:
 *   - 24h / 7d / all — recent failures matter most; 7d covers the
 *     occasional weekend-deferred review.
 */
export function ErrorLogDialog({ trigger, onRegenerate }: ErrorLogDialogProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const acknowledgeError = useTaskStore((s) => s.acknowledgeError);
  const acknowledgeAllErrors = useTaskStore((s) => s.acknowledgeAllErrors);
  const removeTask = useTaskStore((s) => s.removeTask);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"24h" | "7d" | "all">("24h");

  const failed = useMemo(() => {
    const now = Date.now();
    const cutoff =
      filter === "24h"
        ? now - 24 * 60 * 60 * 1000
        : filter === "7d"
          ? now - 7 * 24 * 60 * 60 * 1000
          : 0;

    return Object.values(tasks)
      .filter(
        (t) =>
          (t.status === "FAILED" ||
            t.status === "TIMEOUT" ||
            t.status === "CANCELLED") &&
          t.createdAt >= cutoff,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [tasks, filter]);

  function handleRegenerate(task: GenerationTask) {
    onRegenerate(task);
    // Implicit ack — customer's already moved on to retry.
    acknowledgeError(task.id);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-destructive" />
              Nhật ký lỗi
            </DialogTitle>
            {failed.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={acknowledgeAllErrors}
                title="Đánh dấu tất cả đã xem"
                className="gap-1"
              >
                <CheckCheck className="size-3.5" />
                <span>Đã xem hết</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex items-center gap-1">
          {(["24h", "7d", "all"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={filter === f ? "default" : "outline"}
              size="xs"
              onClick={() => setFilter(f)}
            >
              {f === "24h" ? "24h qua" : f === "7d" ? "7 ngày" : "Tất cả"}
            </Button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {failed.length} lỗi
          </span>
        </div>

        {failed.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="-mx-1 max-h-[60vh] space-y-2 overflow-y-auto px-1">
            {failed.map((t) => (
              <ErrorRow
                key={t.id}
                task={t}
                onRegenerate={() => handleRegenerate(t)}
                onDismiss={() => acknowledgeError(t.id)}
                onDelete={() => removeTask(t.id)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ filter }: { filter: "24h" | "7d" | "all" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center">
      <CheckCheck className="size-8 text-emerald-500" />
      <p className="text-sm font-medium">Không có lỗi nào</p>
      <p className="text-xs text-muted-foreground">
        {filter === "24h"
          ? "Trong 24h qua mọi video đều ổn."
          : filter === "7d"
            ? "Tuần vừa rồi không có sự cố."
            : "Lịch sử sạch."}
      </p>
    </div>
  );
}

function ErrorRow({
  task,
  onRegenerate,
  onDismiss,
  onDelete,
}: {
  task: GenerationTask;
  onRegenerate: () => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const unread = !task.errorAcknowledgedAt;
  const friendly = friendlyError(task.error);
  const tierLabel =
    task.tier === "4k" ? "4K" : task.tier === "pro" ? "1080p" : "720p";

  return (
    <div
      className={
        "rounded-md border p-3 " +
        (unread ? "border-destructive/40 bg-destructive/5" : "bg-muted/20")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                task.status === "CANCELLED" ? "secondary" : "destructive"
              }
              className="text-[10px]"
            >
              {task.status === "FAILED"
                ? "Thất bại"
                : task.status === "TIMEOUT"
                  ? "Quá thời gian"
                  : "Đã huỷ"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-3" />
              {timeAgo(task.createdAt)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {task.mode === "t2v" ? "T2V" : "I2V"} · {tierLabel}
              {task.params?.duration ? ` · ${task.params.duration}s` : ""}
            </span>
            {unread && (
              <span className="ml-auto size-1.5 rounded-full bg-destructive" />
            )}
          </div>
          <p
            className="mt-1 line-clamp-2 text-sm leading-snug"
            title={task.prompt}
          >
            {task.prompt || "(không có prompt)"}
          </p>
          {friendly && (
            <p className="mt-1 line-clamp-2 text-[11px] text-destructive/80">
              {friendly}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {unread && (
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            Đã xem
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={onDelete}
          className="text-muted-foreground"
          title="Xoá khỏi lịch sử"
        >
          <Trash2 className="size-3" />
        </Button>
        <Button
          variant="default"
          size="xs"
          onClick={onRegenerate}
          className="gap-1"
        >
          <RotateCcw className="size-3" />
          Tạo lại
        </Button>
      </div>
    </div>
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "vừa xong";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}p`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
