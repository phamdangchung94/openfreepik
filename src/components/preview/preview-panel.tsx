"use client";

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
import { friendlyError } from "@/lib/error-messages";

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
  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground/80">
            Đang tạo video
            {totalActive > 1 ? ` — ${position}/${totalActive}` : "…"}
          </p>
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
  return (
    <div className="space-y-4">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-destructive/5">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {task.status === "TIMEOUT" ? "Tạo video quá thời gian" : "Tạo video thất bại"}
        </p>
      </div>
      {task.error && (
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
  return (
    <div className="space-y-4">
      <VideoPlayer
        src={task.videoUrl ?? ""}
        poster={task.thumbnailUrl ?? undefined}
      />
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {task.prompt}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {task.mode === "t2v" ? "Văn bản → Video" : "Ảnh → Video"}
            {" / "}
            {task.tier === "pro" ? "Pro" : "Tiêu chuẩn"}
          </p>
          {task.videoUrl && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => window.open(task.videoUrl!, "_blank")}
            >
              <Download className="size-3" />
              Tải về
            </Button>
          )}
        </div>
        {onRegenerate && (
          <Button variant="outline" size="sm" className="w-full" onClick={onRegenerate}>
            <RotateCcw className="size-3.5 mr-1.5" />
            Regenerate
          </Button>
        )}
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
    .filter((t) => t.status === "IN_PROGRESS" || t.status === "CREATED")
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
        {task && (task.status === "FAILED" || task.status === "TIMEOUT") && (
          <ErrorState task={task} onRegenerate={handleRegenerate} />
        )}
        {task &&
          (task.status === "CREATED" || task.status === "IN_PROGRESS") && (
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
