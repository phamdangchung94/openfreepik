"use client";

import { useEffect, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { usePreferencesStore } from "@/store/preferences-store";
import { buildFilename, downloadVideo } from "@/lib/auto-download";

/**
 * Subscribes to the task store and fires a browser download whenever a task
 * transitions into COMPLETED with a videoUrl, while the auto-download
 * preference is on.
 *
 * Idempotency:
 *   - downloadedRef tracks task IDs already downloaded this session.
 *   - We compare prev.tasks[id] to detect a real status transition rather
 *     than re-downloading on every store update for tasks that landed
 *     before the watcher mounted.
 */
export function useAutoDownload() {
  const downloadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Pre-seed: tasks already COMPLETED at mount time should NOT download
    // — auto-download is for new completions only. Otherwise enabling the
    // toggle while old tasks sit in history would trigger a flood.
    const initial = useTaskStore.getState().tasks;
    for (const [id, task] of Object.entries(initial)) {
      if (task.status === "COMPLETED") downloadedRef.current.add(id);
    }

    const unsub = useTaskStore.subscribe((state, prev) => {
      if (!usePreferencesStore.getState().autoDownload) return;

      for (const [id, task] of Object.entries(state.tasks)) {
        if (task.status !== "COMPLETED" || !task.videoUrl) continue;
        if (downloadedRef.current.has(id)) continue;
        const prevTask = prev.tasks[id];
        // Only count it as a transition if it WASN'T completed before.
        if (prevTask?.status === "COMPLETED") {
          downloadedRef.current.add(id);
          continue;
        }

        downloadedRef.current.add(id);
        downloadVideo(
          task.videoUrl,
          buildFilename({
            tier: task.tier,
            prompt: task.prompt,
            createdAt: task.createdAt,
          }),
        );
      }
    });

    return unsub;
  }, []);
}
