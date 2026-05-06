"use client";

import {
  Volume2,
  VolumeX,
  Clock,
  Maximize2,
  Layers,
  Hash,
  Slash,
  Settings2,
} from "lucide-react";
import type { GenerationTask } from "@/store/task-store";

/**
 * Read-only parameter summary shown under the prompt in the preview
 * panel. Reads from the task snapshot (task.params), so customers can
 * verify exactly what settings produced the result they're looking at
 * — useful when regenerating, comparing outputs, or debugging which
 * shot broke.
 *
 * Older tasks created before the params snapshot shipped will lack the
 * field; this component renders an "—" placeholder for missing values
 * and stays compact so it doesn't clutter the panel.
 */
export function ParametersBlock({ task }: { task: GenerationTask }) {
  const p = task.params;

  // Always-visible cells — covers the most-asked questions when a
  // customer says "why does this video look like this".
  const cells: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    {
      icon: <Clock className="size-3" />,
      label: "Thời lượng",
      value: p?.duration ? `${p.duration}s` : "—",
    },
    {
      icon: <Maximize2 className="size-3" />,
      label: "Tỷ lệ",
      value: p?.aspectRatio ?? "—",
    },
    {
      icon:
        p?.audio === true ? (
          <Volume2 className="size-3" />
        ) : (
          <VolumeX className="size-3" />
        ),
      label: "Âm thanh",
      value:
        p?.audio === true ? "Có" : p?.audio === false ? "Không" : "—",
    },
    {
      icon: <Settings2 className="size-3" />,
      label: "CFG",
      value: typeof p?.cfgScale === "number" ? p.cfgScale.toFixed(2) : "—",
    },
  ];

  // Multi-shot row — only render if multi-shot was used (clutter avoidance).
  const multiShotRow =
    p?.multiShot && p.shotCount ? (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Layers className="size-3 shrink-0" />
        <span>{p.shotCount} cảnh (multi-shot)</span>
      </div>
    ) : null;

  // Negative prompt — only render if non-empty.
  const negPrompt = p?.negativePrompt?.trim();
  const negRow = negPrompt ? (
    <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Slash className="mt-0.5 size-3 shrink-0" />
      <span className="line-clamp-2">
        <span className="text-foreground/60">Negative:</span> {negPrompt}
      </span>
    </div>
  ) : null;

  // Task ID — small monospace at bottom for support / debug. Truncated
  // because Magnific UUIDs are 36 chars.
  const taskIdRow = task.taskId ? (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
      <Hash className="size-2.5 shrink-0" />
      <span className="truncate font-mono">{task.taskId}</span>
    </div>
  ) : null;

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-1.5 text-[11px]"
            title={c.label}
          >
            <span className="text-muted-foreground">{c.icon}</span>
            <span className="text-muted-foreground">{c.label}:</span>
            <span className="font-medium text-foreground">{c.value}</span>
          </div>
        ))}
      </div>
      {multiShotRow}
      {negRow}
      {taskIdRow}
    </div>
  );
}
