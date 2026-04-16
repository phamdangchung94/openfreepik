"use client";

import { useMemo } from "react";
import { History, Trash2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTaskStore } from "@/store/task-store";
import { HistoryItem } from "./history-item";

export function HistorySidebar() {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearAll = useTaskStore((s) => s.clearAll);
  const isProcessing = useTaskStore((s) => s.isProcessing);
  const queue = useTaskStore((s) => s.queue);

  const sortedTasks = useMemo(
    () =>
      Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt),
    [tasks]
  );

  const totalTasks = sortedTasks.length;
  const completedInQueue = totalTasks - queue.length;
  const progressValue = totalTasks > 0 ? (completedInQueue / totalTasks) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">History</h2>
        </div>
        {totalTasks > 0 && (
          <Button variant="ghost" size="icon-xs" onClick={clearAll}>
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>

      <Separator />

      {/* Queue progress */}
      {isProcessing && (
        <div className="space-y-1 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Processing {completedInQueue}/{totalTasks}
          </p>
          <Progress value={progressValue} />
        </div>
      )}

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <Video className="size-8 opacity-40" />
              <p className="text-xs">No generations yet</p>
            </div>
          ) : (
            sortedTasks.map((task) => (
              <HistoryItem
                key={task.id}
                task={task}
                isActive={task.id === activeTaskId}
                onClick={() => setActiveTaskId(task.id)}
                onDelete={() => removeTask(task.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
