"use client";

import { toast } from "sonner";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Video, AlertCircle, Loader2, Download, RotateCcw } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { VideoPlayer } from "./video-player";
import { UrlCountdown } from "./url-countdown";
import { friendlyError } from "@/lib/error-messages";
import { buildFilename, downloadVideo } from "@/lib/auto-download";
import { ParametersBlock } from "./parameters-block";

interface PreviewPanelProps {
  onRegenerate?: (task: GenerationTask) => void;
}

function EmptyState() {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-muted/50 px-6 text-center">
      <Video className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm text-foreground/70">Chưa chọn video</p>
      <p className="text-xs text-muted-foreground">
        Chọn 1 video từ lịch sử hoặc tạo mới từ form bên trái.
      </p>
    </div>
  );
}

function LoadingState({
  task,
  position,
  totalActive,
}: {
  task: GenerationTask;
  position: number;
  totalActive: number;
}) {
  // QUEUED = waiting for an upstream slot. Soft message + slower
  // pulse so customers don't think their request is broken.
  const isQueued = task.status === "QUEUED";
  const headline = isQueued
    ? "Đang xếp hàng — chờ slot trống"
    : `Đang tạo video${totalActive > 1 ? ` — ${position}/${totalActive}` : "…"}`;

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader2
            className={`h-8 w-8 animate-spin ${isQueued ? "text-amber-500" : "text-primary"}`}
          />
          <p className="text-sm font-medium text-foreground/80">{headline}</p>
          {isQueued && (
            <p className="text-[11px] text-muted-foreground">
              Pool đang đầy — sẽ tự động chạy khi có slot.
            </p>
          )}
          <p className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
            &ldquo;{task.prompt}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  task,
  onRegenerate,
}: {
  task: GenerationTask;
  onRegenerate?: () => void;
}) {
  const cancelled = task.status === "CANCELLED";
  const heading = cancelled
    ? "Đã huỷ"
    : task.status === "TIMEOUT"
      ? "Tạo video quá thời gian"
      : "Tạo video thất bại";
  return (
    <div className="space-y-4">
      <div
        className={`flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl ${
          cancelled ? "bg-muted/40" : "bg-destructive/5"
        }`}
      >
        <AlertCircle
          className={`h-10 w-10 ${cancelled ? "text-muted-foreground" : "text-destructive"}`}
        />
        <p
          className={`text-sm font-medium ${
            cancelled ? "text-muted-foreground" : "text-destructive"
          }`}
        >
          {heading}
        </p>
      </div>
      {task.error && !cancelled && (
        <p className="text-sm text-destructive/80">{friendlyError(task.error)}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {task.prompt}
      </p>
      {onRegenerate && (
        <Button variant="outline" size="sm" className="w-full" onClick={onRegenerate}>
          <RotateCcw className="size-3.5 mr-1.5" />
          Tạo lại
        </Button>
      )}
    </div>
  );
}

function CompletedState({
  task,
  onRegenerate,
}: {
  task: GenerationTask;
  onRegenerate?: () => void;
}) {
  const markDownloaded = useTaskStore((s) => s.markDownloaded);

  async function handleDownload() {
    if (!task.videoUrl || !task.taskId) return;
    if (task.videoUrlExpiresAt && task.videoUrlExpiresAt < Date.now()) {
      toast.error("Link đã hết hạn — không thể tải");
      return;
    }
    const filename = buildFilename({
      tier: task.tier,
      prompt: task.prompt,
      createdAt: task.createdAt,
    });
    const loading = toast.loading(`Đang tải ${filename}...`);
    const result = await downloadVideo({
      freepikTaskId: task.taskId,
      videoUrl: task.videoUrl,
      filename,
    });
    toast.dismiss(loading);
    if (result.ok) {
      markDownloaded(task.id);
      toast.success(`Đã tải ${filename}`);
    } else {
      const msg =
        result.error === "expired"
          ? "Link đã hết hạn — không thể tải"
          : result.error === "auth"
            ? "Mã kích hoạt hết hạn — vui lòng đăng nhập lại"
            : result.error === "network"
              ? "Lỗi mạng — kiểm tra kết nối và thử lại"
              : "Tải thất bại — thử lại sau";
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-4">
      <VideoPlayer
        src={task.videoUrl ?? ""}
        poster={task.thumbnailUrl ?? undefined}
      />
      <div className="space-y-3">
        {/* Prompt + meta-row condensed: badges instead of long Vietnamese
            phrases — saves vertical space while staying readable. */}
        <p className="text-sm leading-snug text-foreground/90">
          {task.prompt}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
            {task.mode === "t2v" ? "T2V" : "I2V"}
          </span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
            {task.tier === "4k" ? "4K" : task.tier === "pro" ? "1080p" : "720p"}
          </span>
          <span className="ml-auto">
            <UrlCountdown expiresAt={task.videoUrlExpiresAt} />
          </span>
        </div>

        {/* Action bar: Tải về + Regenerate side-by-side instead of two
            full-width stacked buttons. Frees ~36px vertical space. */}
        {(task.videoUrl || onRegenerate) && (
          <div className="grid grid-cols-2 gap-2">
            {task.videoUrl && (
              <Button
                variant="default"
                size="sm"
                onClick={handleDownload}
              >
                <Download className="size-3.5 mr-1.5" />
                {task.downloadedAt ? "Tải lại" : "Tải về"}
              </Button>
            )}
            {onRegenerate && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRegenerate}
                // When download isn't available (no URL yet), span both
                // columns so the regenerate button doesn't look orphaned.
                className={!task.videoUrl ? "col-span-2" : undefined}
              >
                <RotateCcw className="size-3.5 mr-1.5" />
                Tạo lại
              </Button>
            )}
          </div>
        )}

        <ParametersBlock task={task} />
      </div>
    </div>
  );
}

export function PreviewPanel({ onRegenerate }: PreviewPanelProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);

  const task = activeTaskId ? tasks[activeTaskId] : null;

  // Position context for LoadingState — "Generating video — 2 of 5"
  // gives the customer reassurance their batch is moving.
  const activeIds = Object.values(tasks)
    .filter((t) => t.status === "IN_PROGRESS" || t.status === "CREATED" || t.status === "QUEUED")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => t.id);
  const position = task ? activeIds.indexOf(task.id) + 1 : 0;

  const handleRegenerate = task && onRegenerate ? () => onRegenerate(task) : undefined;

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Xem trước</span>
          {task && <StatusBadge status={task.status} />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!task && <EmptyState />}
        {task?.status === "COMPLETED" && (
          <CompletedState task={task} onRegenerate={handleRegenerate} />
        )}
        {task &&
          (task.status === "FAILED" ||
            task.status === "TIMEOUT" ||
            task.status === "CANCELLED") && (
            <ErrorState task={task} onRegenerate={handleRegenerate} />
          )}
        {task &&
          (task.status === "CREATED" || task.status === "IN_PROGRESS" || task.status === "QUEUED") && (
            <LoadingState
              task={task}
              position={position}
              totalActive={activeIds.length}
            />
          )}
      </CardContent>
    </Card>
  );
}
