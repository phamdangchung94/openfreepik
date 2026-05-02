"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  apiKey: string;
  setApiKey: (key: string) => void;
}

const LEGACY_KEY = "openfreepik-tasks";

/**
 * Reads any apiKey persisted under the legacy task-store key so users
 * who saved a key before this split don't lose it. Runs once at startup.
 */
function readLegacyApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return typeof parsed?.state?.apiKey === "string" ? parsed.state.apiKey : "";
  } catch {
    return "";
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      apiKey: "",
      setApiKey: (key) => set({ apiKey: key }),
    }),
    {
      name: "openfreepik-auth",
      onRehydrateStorage: () => (state) => {
        if (state && !state.apiKey) {
          const legacy = readLegacyApiKey();
          if (legacy) state.setApiKey(legacy);
        }
      },
    },
  ),
);
