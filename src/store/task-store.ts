"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type GenerationTaskStatus =
  | "IDLE"
  | "CREATED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "TIMEOUT"
  | "CANCELLED";

export interface GenerationTask {
  id: string;
  taskId: string | null;
  status: GenerationTaskStatus;
  prompt: string;
  mode: "t2v" | "i2v";
  tier: "pro" | "std";
  createdAt: number;
  updatedAt: number;
  videoUrl: string | null;
  /** Epoch ms when the videoUrl is expected to stop working. */
  videoUrlExpiresAt: number | null;
  /**
   * Epoch ms when the customer (or auto-download) last fired a download
   * for this video. Drives the "Đã tải" badge and selection defaults.
   * NOT proof the file landed on disk — the browser doesn't tell us —
   * but a click happened.
   */
  downloadedAt: number | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  error: string | null;
}

interface TaskState {
  tasks: Record<string, GenerationTask>;
  activeTaskId: string | null;

  queue: string[];
  concurrency: number;
  isProcessing: boolean;
  autoEnhance: boolean;

  addTask: (task: GenerationTask) => void;
  updateTask: (id: string, updates: Partial<GenerationTask>) => void;
  /**
   * Idempotent merge — used by the cross-device hydration hook to populate
   * tasks from /api/usage. Existing tasks (by id) keep local fields like
   * `prompt` if present; videoUrl + videoUrlExpiresAt always come from the
   * server source of truth.
   */
  upsertTaskFromServer: (task: GenerationTask) => void;
  /** Stamp downloadedAt = now. Idempotent — overwrites with the latest click. */
  markDownloaded: (id: string) => void;
  removeTask: (id: string) => void;
  clearAll: () => void;
  setActiveTaskId: (id: string | null) => void;
  getActiveTasks: () => GenerationTask[];

  enqueueTasks: (taskIds: string[]) => void;
  dequeueTask: () => string | undefined;
  clearQueue: () => void;
  setConcurrency: (concurrency: number) => void;
  setProcessing: (isProcessing: boolean) => void;
  setAutoEnhance: (v: boolean) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: {},
      activeTaskId: null,

      queue: [],
      concurrency: 3,
      isProcessing: false,
      autoEnhance: false,

      addTask: (task) =>
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task },
        })),

      updateTask: (id, updates) =>
        set((state) => {
          const existing = state.tasks[id];
          if (!existing) return state;
          return {
            tasks: {
              ...state.tasks,
              [id]: { ...existing, ...updates, updatedAt: Date.now() },
            },
          };
        }),

      markDownloaded: (id) =>
        set((state) => {
          const existing = state.tasks[id];
          if (!existing) return state;
          return {
            tasks: {
              ...state.tasks,
              [id]: { ...existing, downloadedAt: Date.now() },
            },
          };
        }),

      upsertTaskFromServer: (task) =>
        set((state) => {
          // Step 1: exact id match (rare — server uses usage_logs.id,
          // local tasks use their own UUID, so this only hits for
          // already-merged entries on subsequent hydrations).
          const byId = state.tasks[task.id];
          if (byId) {
            return {
              tasks: {
                ...state.tasks,
                [task.id]: {
                  ...byId,
                  status: task.status,
                  videoUrl: task.videoUrl,
                  videoUrlExpiresAt: task.videoUrlExpiresAt,
                  updatedAt: Date.now(),
                },
              },
            };
          }

          // Step 2: match by freepikTaskId — same physical task generated
          // through both the local create path AND the server-side row.
          // Without this match, the customer ends up with duplicate
          // history items and an active task whose videoUrl is stale
          // (e.g. expired Magnific URL) while the server has a fresh
          // R2 mirror. Merging here picks up the R2 URL on F5 and the
          // duplicate "(restored from server)" entry never appears.
          if (task.taskId) {
            const matches = Object.values(state.tasks).filter(
              (t) => t.taskId === task.taskId,
            );

            // Prefer a local-origin entry (real prompt) over an orphan
            // "(restored from server)" stub that earlier hydrations may
            // have inserted before this merge logic existed. Sort by
            // prompt presence: any non-restored entry wins.
            matches.sort((a, b) => {
              const aRestored = a.prompt.startsWith("(restored");
              const bRestored = b.prompt.startsWith("(restored");
              if (aRestored && !bRestored) return 1;
              if (!aRestored && bRestored) return -1;
              return a.createdAt - b.createdAt; // older first
            });

            const winner = matches[0];
            if (winner) {
              // Update the winner with server URL/status, drop everyone
              // else (cleans up existing duplicates from past runs).
              const next = { ...state.tasks };
              for (const m of matches) {
                if (m.id !== winner.id) delete next[m.id];
              }
              next[winner.id] = {
                ...winner,
                status: task.status,
                videoUrl: task.videoUrl,
                videoUrlExpiresAt: task.videoUrlExpiresAt,
                updatedAt: Date.now(),
              };
              return {
                tasks: next,
                // Repoint activeTaskId if it was on a now-deleted dup.
                activeTaskId:
                  state.activeTaskId &&
                  matches.some(
                    (m) => m.id === state.activeTaskId && m.id !== winner.id,
                  )
                    ? winner.id
                    : state.activeTaskId,
              };
            }
          }

          // Step 3: no local counterpart — insert as a new entry
          // (cross-device hydration, or task created on another browser).
          return { tasks: { ...state.tasks, [task.id]: task } };
        }),

      removeTask: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.tasks;
          return {
            tasks: rest,
            activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
            queue: state.queue.filter((qId) => qId !== id),
          };
        }),

      clearAll: () =>
        set({ tasks: {}, activeTaskId: null, queue: [], isProcessing: false }),

      setActiveTaskId: (id) => set({ activeTaskId: id }),

      getActiveTasks: () => {
        const { tasks } = get();
        return Object.values(tasks).filter(
          (t) => t.status === "CREATED" || t.status === "IN_PROGRESS"
        );
      },

      enqueueTasks: (taskIds) =>
        set((state) => ({
          queue: [...state.queue, ...taskIds.filter((id) => !state.queue.includes(id))],
        })),

      dequeueTask: () => {
        const { queue } = get();
        if (queue.length === 0) return undefined;
        const [next, ...rest] = queue;
        set({ queue: rest });
        return next;
      },

      clearQueue: () => set({ queue: [], isProcessing: false }),

      setConcurrency: (concurrency) => set({ concurrency }),

      setProcessing: (isProcessing) => set({ isProcessing }),

      setAutoEnhance: (v) => set({ autoEnhance: v }),
    }),
    {
      name: "openfreepik-tasks",
      // Debounced localStorage so a 100-task batch (each task can flip
      // status 2-3 times) doesn't trigger 300 sync writes. Coalesce
      // writes into one every 500ms — final state lands within half a
      // second of the last update, which is fine for crash recovery.
      storage: createJSONStorage(() => debouncedLocalStorage(500)),
    }
  )
);

/**
 * Wraps localStorage with a 500ms debounce on setItem. The persist
 * middleware writes through this on every state change; rapid bursts
 * (e.g. 10 tasks all flipping IN_PROGRESS → COMPLETED inside the same
 * tick) collapse into one final write.
 *
 * getItem/removeItem stay synchronous — they're only called once at
 * hydrate, not in the hot path.
 */
function debouncedLocalStorage(delayMs: number): Storage {
  if (typeof window === "undefined") {
    // SSR fallback — persist middleware tolerates a no-op storage.
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Record<string, string> = {};

  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      pending[key] = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const [k, v] of Object.entries(pending)) {
          window.localStorage.setItem(k, v);
        }
        pending = {};
        timer = null;
      }, delayMs);
    },
    removeItem: (key) => {
      delete pending[key];
      window.localStorage.removeItem(key);
    },
    clear: () => {
      pending = {};
      window.localStorage.clear();
    },
    key: (i) => window.localStorage.key(i),
    get length() {
      return window.localStorage.length;
    },
  } as Storage;
}
