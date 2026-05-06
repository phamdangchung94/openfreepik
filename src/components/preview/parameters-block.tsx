"use client";

import { useState } from "react";
import {
  Volume2,
  VolumeX,
  Clock,
  Maximize2,
  Layers,
  Hash,
  Slash,
  Settings2,
  ChevronDown,
} from "lucide-react";
import type { GenerationTask } from "@/store/task-store";
import { cn } from "@/lib/utils";

/**
 * Read-only parameter summary shown under the prompt in the preview
 * panel. Reads from the task snapshot (task.params), so customers can
 * verify exactly what settings produced the result they're looking at.
 *
 * Defaults to a single-line summary ("5s · 16:9 · 🔊 · CFG 0.50") to
 * keep the panel compact. Click to expand for full details (negative
 * prompt, multi-shot, task_id).
 *
 * Older tasks created before the params snapshot shipped will lack the
 * field; the row shows "Không có params" placeholder.
 */
export function ParametersBlock({ task }: { task: GenerationTask }) {
  const [open, setOpen] = useState(false);
  const p = task.params;
  const hasParams = !!p;

  // Inline summary chips for the collapsed row.
  const summary = hasParams ? (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/80">
      {p.duration && (
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3 text-muted-foreground" />
          {p.duration}s
        </span>
      )}
      {p.aspectRatio && (
        <span className="inline-flex items-center gap-1">
          <Maximize2 className="size-3 text-muted-foreground" />
          {p.aspectRatio}
        </span>
      )}
      {p.audio !== undefined && (
        <span className="inline-flex items-center gap-1">
          {p.audio ? (
            <Volume2 className="size-3 text-muted-foreground" />
          ) : (
            <VolumeX className="size-3 text-muted-foreground" />
          )}
          {p.audio ? "Có audio" : "Không audio"}
        </span>
      )}
      {typeof p.cfgScale === "number" && (
        <span className="inline-flex items-center gap-1">
          <Settings2 className="size-3 text-muted-foreground" />
          CFG {p.cfgScale.toFixed(2)}
        </span>
      )}
    </div>
  ) : (
    <span className="text-[11px] text-muted-foreground/70">
      Không có params (video cũ)
    </span>
  );

  // Detail-only fields — only meaningful when expanded.
  const negPrompt = p?.negativePrompt?.trim();
  const showMultiShot = p?.multiShot && p.shotCount;
  const hasDetails = negPrompt || showMultiShot || task.taskId;

  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        aria-expanded={open}
      >
        {summary}
        {hasDetails && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {open && hasDetails && (
        <div className="space-y-1 border-t border-border/60 px-2.5 py-2 text-[11px]">
          {showMultiShot && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Layers className="size-3 shrink-0" />
              <span>{p.shotCount} cảnh (multi-shot)</span>
            </div>
          )}
          {negPrompt && (
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <Slash className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-3">
                <span className="text-foreground/60">Negative:</span>{" "}
                {negPrompt}
              </span>
            </div>
          )}
          {task.taskId && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
              <Hash className="size-2.5 shrink-0" />
              <span
                className="truncate font-mono"
                title={`Magnific task_id: ${task.taskId}`}
              >
                {task.taskId}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
