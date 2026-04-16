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

interface PreviewPanelProps {
  onRegenerate?: (task: GenerationTask) => void;
}

function EmptyState() {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-muted/50">
      <Video className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No video selected</p>
    </div>
  );
}

function LoadingState({ task }: { task: GenerationTask }) {
  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">
            Generating video...
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {task.prompt}
      </p>
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
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-destructive/5">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {task.status === "TIMEOUT" ? "Generation timed out" : "Generation failed"}
        </p>
      </div>
      {task.error && (
        <p className="text-sm text-destructive/80">{task.error}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {task.prompt}
      </p>
      {onRegenerate && (
        <Button variant="outline" size="sm" className="w-full" onClick={onRegenerate}>
          <RotateCcw className="size-3.5 mr-1.5" />
          Regenerate
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
          <p className="text-xs text-muted-foreground/60">
            {task.mode === "t2v" ? "Text to Video" : "Image to Video"}
            {" / "}
            {task.tier === "pro" ? "Pro" : "Standard"}
          </p>
          {task.videoUrl && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => window.open(task.videoUrl!, "_blank")}
            >
              <Download className="size-3" />
              Download
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

  const handleRegenerate = task && onRegenerate ? () => onRegenerate(task) : undefined;

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Preview</span>
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
            <LoadingState task={task} />
          )}
      </CardContent>
    </Card>
  );
}
