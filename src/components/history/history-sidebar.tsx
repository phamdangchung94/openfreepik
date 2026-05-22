"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckSquare,
  Download,
  History,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { buildFilename, downloadVideo } from "@/lib/auto-download";
import { HistoryItem } from "./history-item";

export function HistorySidebar() {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearAll = useTaskStore((s) => s.clearAll);
  const isProcessing = useTaskStore((s) => s.isProcessing);
  const queue = useTaskStore((s) => s.queue);

  const markDownloaded = useTaskStore((s) => s.markDownloaded);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedTasks = useMemo(
    () => Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt),
    [tasks],
  );

  // Only completed tasks with a still-valid URL are downloadable. Selection
  // mode hides the others' checkboxes so the customer doesn't get into a
  // "selected 5, only 2 downloadable" guessing game.
  const downloadableIds = useMemo(
    () => new Set(sortedTasks.filter(isDownloadable).map((t) => t.id)),
    [sortedTasks],
  );

  // When entering select mode, pre-tick the videos the customer hasn't
  // downloaded yet — the most likely intent for "Tải tất cả".
  const undownloadedIds = useMemo(
    () =>
      new Set(
        sortedTasks
          .filter((t) => isDownloadable(t) && !t.downloadedAt)
          .map((t) => t.id),
      ),
    [sortedTasks],
  );

  const totalTasks = sortedTasks.length;
  const completedInQueue = totalTasks - queue.length;
  const progressValue =
    totalTasks > 0 ? (completedInQueue / totalTasks) * 100 : 0;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllDownloadable() {
    setSelected(new Set(downloadableIds));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function downloadSelected() {
    const ids = [...selected].filter((id) => downloadableIds.has(id));
    if (ids.length === 0) {
      toast.error("Không có video nào tải được trong lựa chọn");
      return;
    }

    const loading = toast.loading(`Đang tải 0/${ids.length} video...`);
    let fired = 0;
    let failed = 0;

    // Sequential through the proxy — each fetch streams ~20MB so we don't
    // want concurrency hammering the Vercel function. The old chunking
    // logic was for the browser's "allow multiple downloads" prompt; with
    // server-side Content-Disposition the prompt doesn't fire any more.
    for (const id of ids) {
      const task = tasks[id];
      if (!task?.videoUrl || !task.taskId) {
        failed++;
        continue;
      }
      toast.loading(`Đang tải ${fired + 1}/${ids.length} video...`, { id: loading });
      const result = await downloadVideo({
        freepikTaskId: task.taskId,
        videoUrl: task.videoUrl,
        filename: buildFilename({
          tier: task.tier,
          prompt: task.prompt,
          createdAt: task.createdAt,
          taskId: task.taskId ?? task.id,
        }),
      });
      if (result.ok) {
        markDownloaded(id);
        fired++;
      } else {
        failed++;
      }
    }

    toast.dismiss(loading);
    if (fired === 0) toast.error("Không tải được video nào — link có thể đã hết hạn");
    else if (failed > 0) toast.warning(`Đã tải ${fired} video; ${failed} thất bại`);
    else toast.success(`Đã tải ${fired} video`);

    exitSelectMode();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Lịch sử</h2>
        </div>
        {totalTasks > 0 && !selectMode && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setSelectMode(true);
                // Pre-select what the user most likely wants — the videos
                // they haven't already saved.
                setSelected(new Set(undownloadedIds));
              }}
              title="Chọn nhiều video để tải cùng lúc"
              disabled={downloadableIds.size === 0}
            >
              <CheckSquare className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={clearAll}
              title="Xoá tất cả"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        )}
        {selectMode && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={exitSelectMode}
            title="Huỷ chọn"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <Separator />

      {/* Selection mode toolbar */}
      {selectMode && (
        <div className="flex flex-col gap-2 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Đã chọn {selected.size} / {downloadableIds.size}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={
                selected.size === downloadableIds.size
                  ? () => setSelected(new Set())
                  : selectAllDownloadable
              }
            >
              {selected.size === downloadableIds.size
                ? "Bỏ chọn hết"
                : "Chọn hết"}
            </Button>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={downloadSelected}
            disabled={selected.size === 0}
            className="w-full"
          >
            <Download className="size-3.5 mr-1.5" />
            Tải {selected.size > 0 ? selected.size : ""} video
          </Button>
        </div>
      )}

      {/* Queue progress */}
      {isProcessing && !selectMode && (
        <div className="space-y-1 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Đang xử lý {completedInQueue}/{totalTasks}
          </p>
          <Progress value={progressValue} />
        </div>
      )}

      {/* Task list — virtualized so 100+ rows still scroll smoothly. The
          old ScrollArea (Radix) doesn't expose a scroll element ref that
          react-virtual can attach to, so we use a native scrolling div. */}
      {sortedTasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center text-muted-foreground">
          <Video className="size-8 opacity-40" />
          <p className="text-sm font-medium text-foreground/70">
            Chưa có video nào
          </p>
          <p className="text-xs text-muted-foreground">
            Nhập prompt từ form bên trái — kết quả sẽ hiện ở đây.
          </p>
        </div>
      ) : (
        <VirtualizedTaskList
          tasks={sortedTasks}
          activeTaskId={activeTaskId}
          selectMode={selectMode}
          selected={selected}
          downloadableIds={downloadableIds}
          onItemClick={(id) => {
            if (selectMode) {
              if (downloadableIds.has(id)) toggleSelect(id);
            } else {
              setActiveTaskId(id);
            }
          }}
          onItemDelete={removeTask}
          onItemToggleSelect={toggleSelect}
        />
      )}
    </div>
  );
}

/**
 * Virtualized list — uses @tanstack/react-virtual to render only the
 * rows currently in the viewport (plus a small overscan buffer). For
 * a 100-task batch this drops re-render cost from ~10ms/update to <1ms.
 *
 * Estimated row height (62px) covers the typical 2-line prompt + badge
 * row. Variable-height rows are handled implicitly by `measureElement`,
 * which the virtualizer remeasures on first paint.
 */
function VirtualizedTaskList({
  tasks,
  activeTaskId,
  selectMode,
  selected,
  downloadableIds,
  onItemClick,
  onItemDelete,
  onItemToggleSelect,
}: {
  tasks: GenerationTask[];
  activeTaskId: string | null;
  selectMode: boolean;
  selected: Set<string>;
  downloadableIds: Set<string>;
  onItemClick: (id: string) => void;
  onItemDelete: (id: string) => void;
  onItemToggleSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 6,
    getItemKey: (i) => tasks[i]!.id,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto"
      // Tailwind doesn't ship a fast-scrolling utility; the native
      // scrollbar is fine here since we no longer use ScrollArea.
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const task = tasks[virtualRow.index]!;
          const downloadable = downloadableIds.has(task.id);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full px-2 pb-1"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <HistoryItem
                task={task}
                isActive={task.id === activeTaskId}
                selectMode={selectMode}
                selectable={downloadable}
                selected={selected.has(task.id)}
                onToggleSelect={() => onItemToggleSelect(task.id)}
                onClick={() => onItemClick(task.id)}
                onDelete={() => onItemDelete(task.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isDownloadable(t: GenerationTask): boolean {
  if (t.status !== "COMPLETED" || !t.videoUrl) return false;
  // Block if expired — the URL almost certainly 404s now. Tasks without an
  // expiry timestamp (legacy or in-flight) are allowed; the download will
  // fail loudly if it's already expired and the toast tells the user.
  if (t.videoUrlExpiresAt && t.videoUrlExpiresAt < Date.now()) return false;
  return true;
}
