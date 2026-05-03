"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ActivationMode = "unlimited" | "quota" | "topup";

export interface ActivationMetadata {
  label: string | null;
  mode: ActivationMode;
  quotaEur: number | null;
  usedEur: number;
  /** quota_eur - used_eur, or null for unlimited mode */
  remainingEur: number | null;
}

/** Subset of metadata returned by POST /api/freepik/* responses. */
export interface BalanceUpdate {
  mode: ActivationMode;
  quotaEur: number | null;
  usedEur: number;
  remainingEur: number | null;
}

interface AuthState {
  /** The activation code itself — also used as the bearer token. */
  activationCode: string;
  /** Public metadata fetched from /api/activate; null until activated. */
  metadata: ActivationMetadata | null;
  setActivation: (code: string, metadata: ActivationMetadata) => void;
  setMetadata: (metadata: ActivationMetadata) => void;
  /** Merge balance fields from a generation response, preserving label. */
  mergeBalance: (balance: BalanceUpdate) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      activationCode: "",
      metadata: null,
      setActivation: (code, metadata) =>
        set({ activationCode: code, metadata }),
      setMetadata: (metadata) => set({ metadata }),
      mergeBalance: (balance) =>
        set((state) =>
          state.metadata ? { metadata: { ...state.metadata, ...balance } } : state,
        ),
      clear: () => set({ activationCode: "", metadata: null }),
    }),
    { name: "openfreepik-auth" },
  ),
);
