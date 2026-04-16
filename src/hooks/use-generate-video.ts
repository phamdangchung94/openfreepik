"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { getApiHeaders } from "@/lib/api-headers";
import type { KlingV3GenerateParams, TaskStatus } from "@/lib/freepik/types";

interface GenerateOpts {
  tier: "pro" | "std";
  prompt: string;
  mode: "t2v" | "i2v";
  imageUrl?: string;
}

interface UseGenerateVideoResult {
  generate: (params: KlingV3GenerateParams, opts: GenerateOpts) => Promise<string>;
  /** Number of currently active (in-flight) generations */
  activeCount: number;
}

/**
 * Fire-and-forget polling for a single task.
 * Runs independently — multiple can run in parallel.
 */
async function pollUntilDone(apiTaskId: string, localId: string) {
  const maxTime = 600_000;
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxTime) {
    try {
      const res = await fetch(`/api/freepik/kling-v3/${apiTaskId}`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const { status, generated } = json.data as { status: TaskStatus; generated: string[] };

      if (status === "COMPLETED") {
        const videoUrl = generated[0] ?? null;
        useTaskStore.getState().updateTask(localId, {
          status: "COMPLETED",
          videoUrl,
        });
        return;
      }
      if (status === "FAILED") {
        useTaskStore.getState().updateTask(localId, {
          status: "FAILED",
          error: "Generation failed",
        });
        return;
      }
      useTaskStore.getState().updateTask(localId, { status: "IN_PROGRESS" });
    } catch {
      // retry on network error
    }
    attempt++;
    const delay = Math.min(2_000 + attempt * 500, 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  useTaskStore.getState().updateTask(localId, {
    status: "TIMEOUT",
    error: "Polling timed out",
  });
}

/**
 * Hook for single video generation — supports multiple concurrent generations.
 * Each `generate()` call is fire-and-forget: it creates the task, POSTs to API,
 * and starts polling independently. The button is NEVER blocked.
 */
export function useGenerateVideo(): UseGenerateVideoResult {
  const activeCountRef = useRef(0);
  // Reactive subscription — only for showing active count badge
  const tasks = useTaskStore((s) => s.tasks);

  // Compute active count from store (tasks that are CREATED or IN_PROGRESS)
  const activeCount = Object.values(tasks).filter(
    (t) => t.status === "CREATED" || t.status === "IN_PROGRESS"
  ).length;

  const generate = useCallback(
    async (params: KlingV3GenerateParams, opts: GenerateOpts): Promise<string> => {
      const localId = crypto.randomUUID();
      const store = useTaskStore.getState();

      store.addTask({
        id: localId,
        taskId: null,
        status: "CREATED",
        prompt: opts.prompt,
        mode: opts.mode,
        tier: opts.tier,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        videoUrl: null,
        thumbnailUrl: null,
        imageUrl: opts.imageUrl ?? null,
        error: null,
      });

      activeCountRef.current++;

      // Fire-and-forget: POST + poll runs in background
      (async () => {
        try {
          const res = await fetch("/api/freepik/kling-v3", {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({ params, tier: opts.tier }),
          });

          if (!res.ok) {
            useTaskStore.getState().updateTask(localId, {
              status: "FAILED",
              error: `HTTP ${res.status}`,
            });
            return;
          }

          const json = await res.json();
          const apiTaskId = json.data.task_id as string;
          useTaskStore.getState().updateTask(localId, {
            taskId: apiTaskId,
            status: "IN_PROGRESS",
          });

          await pollUntilDone(apiTaskId, localId);
        } catch (err) {
          useTaskStore.getState().updateTask(localId, {
            status: "FAILED",
            error: String(err),
          });
        } finally {
          activeCountRef.current--;
        }
      })();

      return localId;
    },
    [],
  );

  return { generate, activeCount };
}
