"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GenerationTaskStatus =
  | "IDLE"
  | "CREATED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "TIMEOUT";

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

      upsertTaskFromServer: (task) =>
        set((state) => {
          const existing = state.tasks[task.id];
          if (!existing) return { tasks: { ...state.tasks, [task.id]: task } };
          // Server wins on URL/expiry/status; local prompt/mode/tier preserved
          // (they're identical anyway, but be conservative).
          return {
            tasks: {
              ...state.tasks,
              [task.id]: {
                ...existing,
                status: task.status,
                videoUrl: task.videoUrl,
                videoUrlExpiresAt: task.videoUrlExpiresAt,
                updatedAt: Date.now(),
              },
            },
          };
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
    }
  )
);
