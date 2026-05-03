"use client";

import { useMemo, useState } from "react";
import {
  CheckSquare,
  Download,
  History,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { buildFilename, downloadVideo } from "@/lib/auto-download";
import { HistoryItem } from "./history-item";

/**
 * Per-batch download cap. Triggering 50+ <a download> clicks at once makes
 * the browser warn ("Allow site to download multiple files?") and some
 * mobile browsers will silently drop the rest. We chunk + delay below.
 */
const DOWNLOAD_BATCH_SIZE = 10;
const DOWNLOAD_BATCH_DELAY_MS = 400;

export function HistorySidebar() {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearAll = useTaskStore((s) => s.clearAll);
  const isProcessing = useTaskStore((s) => s.isProcessing);
  const queue = useTaskStore((s) => s.queue);

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

    toast.success(`Đang tải ${ids.length} video...`);

    // Chunk to avoid the browser's "allow multiple downloads" prompt.
    for (let i = 0; i < ids.length; i += DOWNLOAD_BATCH_SIZE) {
      const slice = ids.slice(i, i + DOWNLOAD_BATCH_SIZE);
      for (const id of slice) {
        const task = tasks[id];
        if (!task?.videoUrl) continue;
        downloadVideo(
          task.videoUrl,
          buildFilename({
            tier: task.tier,
            prompt: task.prompt,
            createdAt: task.createdAt,
          }),
        );
      }
      if (i + DOWNLOAD_BATCH_SIZE < ids.length) {
        await new Promise((r) => setTimeout(r, DOWNLOAD_BATCH_DELAY_MS));
      }
    }

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
              onClick={() => setSelectMode(true)}
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

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-muted-foreground">
              <Video className="size-8 opacity-40" />
              <p className="text-sm font-medium text-foreground/70">
                Chưa có video nào
              </p>
              <p className="text-xs text-muted-foreground">
                Nhập prompt từ form bên trái — kết quả sẽ hiện ở đây.
              </p>
            </div>
          ) : (
            sortedTasks.map((task) => {
              const downloadable = downloadableIds.has(task.id);
              return (
                <HistoryItem
                  key={task.id}
                  task={task}
                  isActive={task.id === activeTaskId}
                  selectMode={selectMode}
                  selectable={downloadable}
                  selected={selected.has(task.id)}
                  onToggleSelect={() => toggleSelect(task.id)}
                  onClick={() => {
                    if (selectMode) {
                      if (downloadable) toggleSelect(task.id);
                    } else {
                      setActiveTaskId(task.id);
                    }
                  }}
                  onDelete={() => removeTask(task.id)}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
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
