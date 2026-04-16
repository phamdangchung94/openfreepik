"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import { toBatchApiParams } from "@/lib/form/to-api-params";
import type { BatchItem, GeneratorFormValues } from "@/lib/form/generator-schema";
import type { TaskStatus } from "@/lib/freepik/types";

interface UseBatchQueueResult {
  startBatch: (items: BatchItem[], formValues: GeneratorFormValues) => void;
  cancelBatch: () => void;
  isProcessing: boolean;
  progress: { completed: number; total: number; failed: number };
}

async function enhancePrompt(prompt: string): Promise<string> {
  if (!prompt.trim()) return prompt;
  try {
    const res = await fetch("/api/freepik/improve-prompt", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ prompt, type: "video", language: "en" }),
    });
    if (!res.ok) return prompt;
    const { data } = await res.json();
    const taskId = data.task_id;

    const start = Date.now();
    while (Date.now() - start < 60_000) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`/api/freepik/improve-prompt/${taskId}`, {
        headers: getApiHeaders(),
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      if (pollData.data.status === "COMPLETED") {
        return pollData.data.generated[0] ?? prompt;
      }
      if (pollData.data.status === "FAILED") return prompt;
    }
    return prompt;
  } catch {
    return prompt;
  }
}

async function pollTask(apiTaskId: string, localId: string) {
  const interval = 2_000;
  const maxTime = 600_000;
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxTime) {
    try {
      const res = await fetch(`/api/freepik/kling-v3/${apiTaskId}`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) {
        const errMsg = await extractErrorMessage(res);
        throw new Error(errMsg);
      }
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
        useTaskStore.getState().updateTask(localId, { status: "FAILED", error: "Generation failed" });
        return;
      }
      useTaskStore.getState().updateTask(localId, { status: "IN_PROGRESS" });
    } catch {
      // retry on network error
    }
    attempt++;
    const delay = Math.min(interval + attempt * 500, 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  useTaskStore.getState().updateTask(localId, { status: "TIMEOUT", error: "Polling timed out" });
}

export function useBatchQueue(): UseBatchQueueResult {
  const isProcessing = useTaskStore((s) => s.isProcessing);
  const tasks = useTaskStore((s) => s.tasks);

  const activeRef = useRef(0);
  const cancelledRef = useRef(false);
  const batchIdsRef = useRef<Set<string>>(new Set());
  const itemMapRef = useRef<Map<string, { imageUrl: string; prompt: string }>>(new Map());
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
        prompt = await enhancePrompt(prompt);
        useTaskStore.getState().updateTask(localId, { prompt });
      }

      const params = toBatchApiParams(formValues, itemData.imageUrl, prompt);
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
      await pollTask(apiTaskId, localId);
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
        itemMapRef.current.set(localId, { imageUrl: item.imageUrl, prompt: item.prompt });

        store.addTask({
          id: localId,
          taskId: null,
          status: "CREATED",
          prompt: item.prompt,
          mode: "i2v",
          tier: formValues.tier,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          videoUrl: null,
          thumbnailUrl: null,
          imageUrl: item.imageUrl,
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
    activeRef.current = 0; // Reset so next batch starts clean
    useTaskStore.getState().clearQueue();
  }, []);

  return { startBatch, cancelBatch, isProcessing, progress };
}
