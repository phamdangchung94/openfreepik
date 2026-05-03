"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PrefsState {
  /** Auto-trigger a browser download whenever a task transitions to COMPLETED. */
  autoDownload: boolean;
  /** Whether the customer has seen the auto-download warning at least once. */
  warningSeen: boolean;
  setAutoDownload: (v: boolean) => void;
  markWarningSeen: () => void;
}

export const usePreferencesStore = create<PrefsState>()(
  persist(
    (set) => ({
      autoDownload: false,
      warningSeen: false,
      setAutoDownload: (v) => set({ autoDownload: v }),
      markWarningSeen: () => set({ warningSeen: true }),
    }),
    { name: "openfreepik-prefs" },
  ),
);
