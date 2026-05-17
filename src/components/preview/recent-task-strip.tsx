"use client";

import { useMemo } from "react";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { CheckCircle2, AlertCircle, Loader2, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const STRIP_LIMIT = 12;

/**
 * Horizontal-scroll thumbnail strip of recent tasks. Lets the customer
 * swap which task the preview panel shows without having to switch to
 * the History tab on mobile. Mobile-only (`md:hidden`) because desktop
 * already has the History sidebar visible alongside the preview pane.
 *
 * Hides itself if there's only zero or one task — the strip would be
 * empty padding in that case.
 */
export function RecentTaskStrip() {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);

  const recent = useMemo(() => {
    return Object.values(tasks)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, STRIP_LIMIT);
  }, [tasks]);

  if (recent.length < 2) return null;

  return (
    // Negative margin matches CardContent's px-4 so the strip extends
    // edge-to-edge of the card; inner padding keeps thumbs visually
    // aligned with surrounding content. Gradient overlay at the right
    // edge hints "scroll for more".
    <div className="relative -mx-4 mb-3 md:hidden">
      <div
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-4 pb-1"
        // Hide scrollbar visually but keep keyboard accessibility.
        style={{ scrollbarWidth: "none" }}
      >
        {recent.map((t) => (
          <TaskThumb
            key={t.id}
            task={t}
            active={t.id === activeTaskId}
            onClick={() => setActiveTaskId(t.id)}
          />
        ))}
      </div>
      {/* Right-edge fade — visual cue that more thumbs scroll. Only
          shown when 5+ tasks (likely overflow on 375px viewport). */}
      {recent.length >= 5 && (
        <div className="pointer-events-none absolute right-0 top-0 h-14 w-8 bg-gradient-to-l from-card to-transparent" />
      )}
    </div>
  );
}

function TaskThumb({
  task,
  active,
  onClick,
}: {
  task: GenerationTask;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      aria-label={task.prompt ? `Xem: ${task.prompt.slice(0, 40)}` : "Xem video"}
      className={cn(
        "relative size-14 shrink-0 snap-start overflow-hidden rounded-md border-2 bg-muted transition-all",
        active
          ? "border-primary shadow-md"
          : "border-transparent opacity-80 hover:opacity-100",
      )}
    >
      {task.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={task.thumbnailUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Video className="size-5" />
        </div>
      )}
      <span className="pointer-events-none absolute inset-0 flex items-end justify-end p-0.5">
        <StatusDot task={task} />
      </span>
    </button>
  );
}

function StatusDot({ task }: { task: GenerationTask }) {
  if (task.status === "COMPLETED") {
    return (
      <span className="rounded-full bg-emerald-500/95 p-0.5 text-white shadow">
        <CheckCircle2 className="size-3" />
      </span>
    );
  }
  if (task.status === "FAILED" || task.status === "TIMEOUT") {
    return (
      <span className="rounded-full bg-destructive/95 p-0.5 text-white shadow">
        <AlertCircle className="size-3" />
      </span>
    );
  }
  if (task.status === "QUEUED") {
    return (
      <span className="rounded-full bg-amber-500/95 p-0.5 text-white shadow">
        <Loader2 className="size-3 animate-spin" />
      </span>
    );
  }
  if (task.status === "CREATED" || task.status === "IN_PROGRESS") {
    return (
      <span className="rounded-full bg-primary/95 p-0.5 text-primary-foreground shadow">
        <Loader2 className="size-3 animate-spin" />
      </span>
    );
  }
  return null;
}
