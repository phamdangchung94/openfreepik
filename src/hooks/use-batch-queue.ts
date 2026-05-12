"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { useAuthStore, type BalanceUpdate } from "@/store/auth-store";
import { getApiHeaders, extractErrorBody } from "@/lib/api-headers";
import {
  toBatchApiParams,
  toBatchT2VParams,
  toBatchKling4kT2vParams,
  toBatchKling4kI2vParams,
} from "@/lib/form/to-api-params";
import { pollTaskUntilDone, type PollEndpoint } from "@/lib/freepik/poll-task";
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
  endpoint: PollEndpoint,
  signal: AbortSignal,
) {
  const result = await pollTaskUntilDone({
    apiTaskId,
    endpoint,
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
      // CREATED = client picked it up, hasn't dispatched yet.
      // QUEUED = dispatched but server pool was saturated; client
      // is auto-retrying. Both count as "queued" for the widget.
      else if (t.status === "CREATED" || t.status === "QUEUED") queued++;
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

      // Dispatch:
      //   tier='4k' on Kling 3 → kling-4k-{t2v,i2v} endpoints (no
      //                          tier in body, no multi-shot)
      //   Pro/Std on Kling 3 → kling-v3 endpoint (tier in body)
      //   WAN 2.7            → not wired through the batch UI today;
      //                        falls through to FAILED if it reaches here
      let endpoint: PollEndpoint;
      let body: object;
      if (formValues.model === "kling-v3" && formValues.tier === "4k") {
        if (itemData.mode === "i2v" && itemData.imageUrl) {
          endpoint = "kling-4k-i2v";
          body = {
            params: toBatchKling4kI2vParams(formValues, itemData.imageUrl, prompt),
          };
        } else {
          endpoint = "kling-4k-t2v";
          body = { params: toBatchKling4kT2vParams(formValues, prompt) };
        }
      } else if (formValues.model === "kling-v3") {
        const params =
          itemData.mode === "i2v" && itemData.imageUrl
            ? toBatchApiParams(formValues, itemData.imageUrl, prompt)
            : toBatchT2VParams(formValues, prompt);
        endpoint = "kling-v3";
        body = { params, tier: formValues.tier };
      } else {
        useTaskStore.getState().updateTask(localId, {
          status: "FAILED",
          error: `Batch chưa hỗ trợ model ${formValues.model}`,
        });
        return;
      }

      // Retry policy mirrors use-generate-video: when the upstream
      // pool is saturated by the per-key concurrency cap, queue the
      // request and retry every 5s for up to 5 minutes. The ABORT
      // signal still wins — cancelling the batch interrupts the wait.
      const QUEUE_RETRY_DELAY_MS = 5_000;
      const QUEUE_MAX_WAIT_MS = 5 * 60_000;
      const queueStart = Date.now();
      let json: { data: { task_id: string }; balance?: BalanceUpdate } | null = null;
      for (;;) {
        if (signal.aborted) return;
        const res = await fetch(`/api/freepik/${endpoint}`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify(body),
          signal,
        });
        if (res.ok) {
          json = await res.json();
          break;
        }
        const err = await extractErrorBody(res);
        if (
          err.code === "NO_KEYS_AVAILABLE" &&
          Date.now() - queueStart < QUEUE_MAX_WAIT_MS
        ) {
          useTaskStore.getState().updateTask(localId, {
            status: "QUEUED",
            error: null,
          });
          await new Promise((r) => setTimeout(r, QUEUE_RETRY_DELAY_MS));
          continue;
        }
        useTaskStore.getState().updateTask(localId, {
          status: "FAILED",
          error: err.message,
        });
        return;
      }
      if (!json) {
        useTaskStore.getState().updateTask(localId, {
          status: "FAILED",
          error: "Hàng đợi quá tải — vui lòng thử lại sau",
        });
        return;
      }
      const apiTaskId = json.data.task_id as string;
      useTaskStore.getState().updateTask(localId, { taskId: apiTaskId, status: "IN_PROGRESS" });
      if (json.balance) {
        useAuthStore.getState().mergeBalance(json.balance);
      }
      await runPollTask(apiTaskId, localId, endpoint, signal);
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
