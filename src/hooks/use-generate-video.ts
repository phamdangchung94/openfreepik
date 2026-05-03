"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { getApiHeaders, extractErrorMessage, requireActivationCode } from "@/lib/api-headers";
import { useAuthStore } from "@/store/auth-store";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";
import { expiresFromNow } from "@/lib/video-url-ttl";
import type { KlingV3GenerateParams } from "@/lib/freepik/types";

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
      // Validate activation code before creating task
      requireActivationCode();

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
        videoUrlExpiresAt: null,
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
            const errMsg = await extractErrorMessage(res);
            useTaskStore.getState().updateTask(localId, {
              status: "FAILED",
              error: errMsg,
            });
            return;
          }

          const json = await res.json();
          const apiTaskId = json.data.task_id as string;
          useTaskStore.getState().updateTask(localId, {
            taskId: apiTaskId,
            status: "IN_PROGRESS",
          });
          if (json.balance) {
            useAuthStore.getState().mergeBalance(json.balance);
          }

          const result = await pollTaskUntilDone({
            apiTaskId,
            endpoint: "kling-v3",
            onProgress: (status) => {
              if (status === "IN_PROGRESS") {
                useTaskStore.getState().updateTask(localId, { status });
              }
            },
          });

          if (result.status === "COMPLETED") {
            useTaskStore.getState().updateTask(localId, {
              status: "COMPLETED",
              videoUrl: result.generated[0] ?? null,
              videoUrlExpiresAt: expiresFromNow(),
            });
          } else {
            useTaskStore.getState().updateTask(localId, {
              status: result.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
              error: result.error ?? "Generation failed",
            });
          }
        } catch (err) {
          useTaskStore.getState().updateTask(localId, {
            status: "FAILED",
            error: err instanceof Error ? err.message : String(err),
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
