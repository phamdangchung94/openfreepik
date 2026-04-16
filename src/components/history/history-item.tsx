"use client";

import { Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/preview/status-badge";
import { cn } from "@/lib/utils";
import type { GenerationTask } from "@/store/task-store";

interface HistoryItemProps {
  task: GenerationTask;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function HistoryItem({ task, isActive, onClick, onDelete }: HistoryItemProps) {
  const hasThumb = task.mode === "i2v" && task.imageUrl;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className={cn(
        "group relative flex gap-3 rounded-lg border p-2 transition-colors cursor-pointer hover:bg-muted/50",
        isActive ? "border-primary bg-primary/5" : "border-transparent hover:border-border",
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        {hasThumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={task.imageUrl!} alt="Source" className="size-10 rounded-md object-cover" />
        ) : (
          <Video className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 text-xs leading-snug">{task.prompt || "Untitled generation"}</p>
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} className="scale-90 origin-left" />
          <span className="text-[10px] text-muted-foreground">{timeAgo(task.createdAt)}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
