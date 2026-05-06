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
  /**
   * Re-queue every FAILED/TIMEOUT task from the most recent batch. Resets
   * their status to CREATED and uses the previously-stored prompt/mode/
   * formValues — no need to re-upload anything.
   */
  retryFailed: () => number;
  isProcessing: boolean;
  progress: {
    completed: number;
    total: number;
    failed: number;
    /** Tasks currently in-flight (IN_PROGRESS — fetch/poll running). */
    running: number;
    /** Tasks queued but waiting for a free concurrency slot. */
    queued: number;
  };
}

async function runPollTask(
  apiTaskId: string,
  localId: string,
  signal: AbortSignal,
) {
  const result = await pollTaskUntilDone({
    apiTaskId,
    endpoint: "kling-v3",
    signal,
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
  } else if (result.status === "CANCELLED") {
    // The user-cancel path overwrites the task status separately in
    // cancelBatch(). Don't clobber it here — leave whatever status
    // cancelBatch already set (CANCELLED). Setting "CANCELLED" again
    // would be fine but avoiding the double-write keeps audit logs clean.
    return;
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
  // Per-batch AbortController; cancelBatch aborts it so in-flight POSTs
  // and poll loops bail immediately instead of running to completion.
  const abortRef = useRef<AbortController | null>(null);
  // Break circular useCallback dependency: runTask -> fillSlots -> runTask
  const fillSlotsRef = useRef<() => void>(() => {});

  const progress = (() => {
    const ids = batchIdsRef.current;
    let completed = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;
    for (const id of ids) {
      const t = tasks[id];
      if (!t) continue;
      if (t.status === "COMPLETED") completed++;
      else if (
        t.status === "FAILED" ||
        t.status === "TIMEOUT" ||
        t.status === "CANCELLED"
      ) {
        // CANCELLED counts as failed for the "remaining work" tally — the
        // customer cancelled it intentionally but it's still a non-success
        // terminal state. retryFailed() covers all three.
        failed++;
      } else if (t.status === "IN_PROGRESS") running++;
      else if (t.status === "CREATED") queued++;
    }
    return { completed, total: ids.size, failed, running, queued };
  })();

  const runTask = useCallback(async (localId: string) => {
    // Capture controller once at start; any later cancelBatch() flips its
    // signal, which both the fetch and the poll loop respect.
    const signal = abortRef.current?.signal ?? new AbortController().signal;
    try {
      if (signal.aborted) return;
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

      if (signal.aborted) return;

      const params =
        itemData.mode === "i2v" && itemData.imageUrl
          ? toBatchApiParams(formValues, itemData.imageUrl, prompt)
          : toBatchT2VParams(formValues, prompt);
      const res = await fetch("/api/freepik/kling-v3", {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ params, tier: formValues.tier }),
        signal,
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
      await runPollTask(apiTaskId, localId, signal);
    } catch (err) {
      // AbortError = caller cancelled. Don't overwrite the CANCELLED
      // status that cancelBatch() already wrote.
      if (signal.aborted) return;
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
      // Fresh AbortController per batch. cancelBatch() aborts this one;
      // a subsequent startBatch installs a new one so the old signal stays
      // aborted forever (which is what we want — late-arriving callbacks
      // from the cancelled batch just bail).
      abortRef.current = new AbortController();

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
          // Form values are shared across the whole batch — snapshot
          // them on every task so the preview shows the params even
          // after the customer changes the form for the next batch.
          params: {
            duration: formValues.duration,
            aspectRatio: formValues.aspect_ratio,
            audio: formValues.generate_audio,
            cfgScale: formValues.cfg_scale,
            negativePrompt: formValues.negative_prompt,
            multiShot: formValues.multi_shot,
            shotCount: formValues.multi_prompt?.length,
          },
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

    // Mark every still-running task in the current batch as CANCELLED
    // BEFORE clearing batchIdsRef — otherwise the Preview Panel keeps
    // showing "Đang tạo video..." for IN_PROGRESS tasks. Customer-
    // expected: clicking Huỷ instantly flips the preview UI.
    const store = useTaskStore.getState();
    for (const id of batchIdsRef.current) {
      const t = store.tasks[id];
      if (!t) continue;
      if (t.status === "IN_PROGRESS" || t.status === "CREATED") {
        store.updateTask(id, {
          status: "CANCELLED",
          error: "Đã huỷ",
        });
      }
    }

    // Abort the AbortController so in-flight POSTs and poll loops bail
    // mid-flight instead of running to completion.
    abortRef.current?.abort();
    abortRef.current = null;

    activeRef.current = 0;
    // Note: keep itemMapRef + batchIdsRef so retryFailed() can still
    // resurrect the cancelled tasks (cancelled counts as "failed" in the
    // progress widget, and the customer often wants Retry after a manual
    // cancel that they regret).
    formRef.current = null;
    store.clearQueue();
    store.setProcessing(false);
  }, []);

  const retryFailed = useCallback(() => {
    const store = useTaskStore.getState();
    const ids = batchIdsRef.current;
    const failedIds: string[] = [];

    for (const id of ids) {
      const t = store.tasks[id];
      if (!t) continue;
      if (
        t.status !== "FAILED" &&
        t.status !== "TIMEOUT" &&
        t.status !== "CANCELLED"
      ) {
        continue;
      }
      // Need a prompt-mode-tier triple in itemMapRef to re-run; if missing,
      // bail on that one (e.g. tasks rehydrated from server have no entry).
      if (!itemMapRef.current.has(id)) continue;
      failedIds.push(id);
    }

    if (failedIds.length === 0 || !formRef.current) return 0;

    // Reset task status so the UI flips back to CREATED. updateTask refuses
    // to clobber a non-existent task, so this is safe even if the customer
    // manually deleted some history items mid-batch.
    for (const id of failedIds) {
      store.updateTask(id, {
        status: "CREATED",
        videoUrl: null,
        videoUrlExpiresAt: null,
        error: null,
        taskId: null,
      });
    }

    cancelledRef.current = false;
    store.enqueueTasks(failedIds);
    store.setProcessing(true);
    fillSlotsRef.current();
    return failedIds.length;
  }, []);

  return { startBatch, cancelBatch, retryFailed, isProcessing, progress };
}
