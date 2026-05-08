"use client";

import { create } from "zustand";
import type { GenerationTask } from "./task-store";

/**
 * Tiny ephemeral registry for the page-level regenerate handler.
 *
 * Why exists: components in the global AppHeader (e.g. ErrorLogButton)
 * need to trigger the same "regenerate this task" flow that the
 * preview panel exposes — but the handler implementation lives in the
 * page (loadTask + scrollToTop + toast). Layout is a Server Component,
 * so we can't prop-drill the callback in. A 4-line zustand bridge is
 * cleaner than a window event or a context provider.
 *
 * Lifecycle: page registers on mount + clears on unmount; button reads
 * the current ref and falls back to a no-op if the page hasn't mounted
 * yet (e.g. mid-route-transition).
 */
export interface RegenerateHandlerState {
  handler: ((task: GenerationTask) => void) | null;
  setHandler: (h: ((task: GenerationTask) => void) | null) => void;
}

export const useRegenerateHandler = create<RegenerateHandlerState>((set) => ({
  handler: null,
  setHandler: (handler) => set({ handler }),
}));
