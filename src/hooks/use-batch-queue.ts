"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { useAuthStore } from "@/store/auth-store";
import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import { toBatchApiParams, toBatchT2VParams } from "@/lib/form/to-api-params";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";
import { enhancePromptOnce } from "@/lib/improve-prompt-runner";
import { expiresFromNow } from "@/lib/video-url-ttl";
import type { BatchItem, GeneratorFormValues } from "@/lib/form/generator-schema";

interface UseBatchQueueResult {
  startBatch: (items: BatchItem[], formValues: GeneratorFormValues) => void;
  cancelBatch: () => void;
  isProcessing: boolean;
  progress: { completed: number; total: number; failed: number };
}

async function runPollTask(apiTaskId: string, localId: string) {
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
}

export function useBatchQueue(): UseBatchQueueResult {
  const isProcessing = useTaskStore((s) => s.isProcessing);
  const tasks = useTaskStore((s) => s.tasks);

  const activeRef = useRef(0);
  const cancelledRef = useRef(false);
  const batchIdsRef = useRef<Set<string>>(new Set());
  const itemMapRef = useRef<
    Map<string, { mode: "t2v" | "i2v"; imageUrl?: string; prompt: string }>
  >(new Map());
  const formRef = useRef<GeneratorFormValues | null>(null);
  // Break circular useCallback dependency: runTask -> fillSlots -> runTask
  const fillSlotsRef = useRef<() => void>(() => {});

  const progress = (() => {
    const ids = batchIdsRef.current;
    let completed = 0;
    let failed = 0;
    for (const id of ids) {
      const t = tasks[id];
      if (!t) continue;
      if (t.status === "COMPLETED") completed++;
      if (t.status === "FAILED" || t.status === "TIMEOUT") failed++;
    }
    return { completed, total: ids.size, failed };
  })();

  const runTask = useCallback(async (localId: string) => {
    try {
      const itemData = itemMapRef.current.get(localId);
      const formValues = formRef.current;
      if (!itemData || !formValues) return;

      let prompt = itemData.prompt;
      const { autoEnhance } = useTaskStore.getState();

      if (autoEnhance && prompt.trim()) {
        useTaskStore.getState().updateTask(localId, { status: "CREATED" });
        prompt = await enhancePromptOnce(prompt);
        useTaskStore.getState().updateTask(localId, { prompt });
      }

      const params =
        itemData.mode === "i2v" && itemData.imageUrl
          ? toBatchApiParams(formValues, itemData.imageUrl, prompt)
          : toBatchT2VParams(formValues, prompt);
      const res = await fetch("/api/freepik/kling-v3", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ params, tier: formValues.tier }),
      });

      if (!res.ok) {
        const errMsg = await extractErrorMessage(res);
        useTaskStore.getState().updateTask(localId, { status: "FAILED", error: errMsg });
        return;
      }

      const json = await res.json();
      const apiTaskId = json.data.task_id as string;
      useTaskStore.getState().updateTask(localId, { taskId: apiTaskId, status: "IN_PROGRESS" });
      if (json.balance) {
        useAuthStore.getState().mergeBalance(json.balance);
      }
      await runPollTask(apiTaskId, localId);
    } catch (err) {
      useTaskStore.getState().updateTask(localId, { status: "FAILED", error: String(err) });
    } finally {
      activeRef.current--;
      fillSlotsRef.current(); // Always calls latest fillSlots via ref
    }
  }, []);

  const fillSlots = useCallback(() => {
    if (cancelledRef.current) return;
    const state = useTaskStore.getState();
    const available = state.concurrency - activeRef.current;
    if (available <= 0 || state.queue.length === 0) {
      if (activeRef.current === 0 && state.queue.length === 0) {
        state.setProcessing(false);
      }
      return;
    }

    const toProcess = state.queue.slice(0, available);
    const remaining = state.queue.slice(available);
    useTaskStore.setState({ queue: remaining });

    for (const localId of toProcess) {
      activeRef.current++;
      runTask(localId);
    }
  }, [runTask]);

  // Keep ref in sync so runTask always calls the latest fillSlots
  fillSlotsRef.current = fillSlots;

  const startBatch = useCallback(
    (items: BatchItem[], formValues: GeneratorFormValues) => {
      cancelledRef.current = false;
      activeRef.current = 0; // Reset — guarantee clean slate for new batch
      formRef.current = formValues;
      itemMapRef.current.clear();
      batchIdsRef.current = new Set();

      const store = useTaskStore.getState();
      // Clear any stale queue from previous session/batch
      store.clearQueue();
      const ids: string[] = [];

      for (const item of items) {
        const localId = crypto.randomUUID();
        ids.push(localId);
        batchIdsRef.current.add(localId);
        itemMapRef.current.set(localId, {
          mode: item.mode,
          imageUrl: item.imageUrl,
          prompt: item.prompt,
        });

        store.addTask({
          id: localId,
          taskId: null,
          status: "CREATED",
          prompt: item.prompt,
          mode: item.mode,
          tier: formValues.tier,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          videoUrl: null,
          videoUrlExpiresAt: null,
          downloadedAt: null,
          thumbnailUrl: null,
          imageUrl: item.imageUrl ?? null,
          error: null,
        });
      }

      store.enqueueTasks(ids);
      store.setProcessing(true);
      fillSlots();
    },
    [fillSlots],
  );

  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    activeRef.current = 0;
    itemMapRef.current.clear();
    batchIdsRef.current = new Set();
    formRef.current = null;
    useTaskStore.getState().clearQueue();
  }, []);

  return { startBatch, cancelBatch, isProcessing, progress };
}
