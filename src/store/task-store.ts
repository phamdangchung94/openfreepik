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
  thumbnailUrl: string | null;
  imageUrl: string | null;
  error: string | null;
}

interface TaskState {
  tasks: Record<string, GenerationTask>;
  activeTaskId: string | null;
  apiKey: string;

  queue: string[];
  concurrency: number;
  isProcessing: boolean;
  autoEnhance: boolean;

  addTask: (task: GenerationTask) => void;
  updateTask: (id: string, updates: Partial<GenerationTask>) => void;
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
  setApiKey: (key: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: {},
      activeTaskId: null,
      apiKey: "",

      queue: [],
      concurrency: 5,
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
      setApiKey: (key) => set({ apiKey: key }),
    }),
    {
      name: "openfreepik-tasks",
    }
  )
);
