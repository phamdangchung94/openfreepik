"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { getApiHeaders } from "@/lib/api-headers";

/**
 * Cross-device history rehydration.
 *
 * Without this, opening the app on a 2nd device with the same activation
 * code shows an empty history — task-store is per-browser localStorage.
 * On activation, fetch the server-side usage log and upsert any
 * completed-with-videoUrl rows into the local task store so the customer
 * can still play / download / re-download the video while the URL lives.
 *
 * Idempotent: re-runs on every activation event but only writes new
 * tasks (or refreshes URL/expiry on existing ones via upsertTaskFromServer).
 */

interface UsageRecentRow {
  id: string;
  createdAt: string;
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: number;
  freepikTaskId: string | null;
  videoUrl: string | null;
  videoUrlExpiresAt: string | null;
  status: "succeeded" | "failed" | "refunded" | "pending";
}

async function hydrateOnce() {
  const { activationCode } = useAuthStore.getState();
  if (!activationCode) return;

  let recent: UsageRecentRow[];
  try {
    const res = await fetch("/api/usage", { headers: getApiHeaders() });
    if (!res.ok) return; // 401 is expected pre-activation; just bail
    const json = await res.json();
    recent = json.recent ?? [];
  } catch {
    return;
  }

  // Only hydrate rows that have a usable URL — failed/refunded/pending are
  // either irrelevant or already represented by the local task that's
  // still polling. Skip rows whose URL has already expired (R2 deleted
  // the object); sweep-expired-urls cron clears these to null in the DB
  // but we double-check the timestamp in case the cron is behind.
  const now = Date.now();
  const usable = recent.filter(
    (r) =>
      r.status === "succeeded" &&
      r.videoUrl &&
      r.endpoint === "kling-v3" &&
      r.freepikTaskId &&
      (!r.videoUrlExpiresAt ||
        new Date(r.videoUrlExpiresAt).getTime() > now),
  );

  const upsert = useTaskStore.getState().upsertTaskFromServer;

  for (const r of usable) {
    const task: GenerationTask = {
      // Use the server row id as the task id when no local task exists yet.
      // For locally-originated tasks, the id won't match — they'll just
      // show up as a duplicate entry with the server-known URL. Acceptable
      // for v1; a follow-up could match by freepikTaskId.
      id: r.id,
      taskId: r.freepikTaskId,
      status: "COMPLETED",
      prompt: "(restored from server)",
      mode: "t2v",
      tier: r.tier ?? "std",
      createdAt: new Date(r.createdAt).getTime(),
      updatedAt: Date.now(),
      videoUrl: r.videoUrl,
      videoUrlExpiresAt: r.videoUrlExpiresAt
        ? new Date(r.videoUrlExpiresAt).getTime()
        : null,
      // Server has no record of who downloaded what — start unmarked. The
      // upsert never clobbers an existing local downloadedAt so customer
      // re-opens on the same device keep their badges.
      downloadedAt: null,
      thumbnailUrl: null,
      imageUrl: null,
      error: null,
    };
    upsert(task);
  }
}

export function useHistoryHydration() {
  useEffect(() => {
    // Initial — wait a tick for Zustand to hydrate from localStorage so
    // we don't double-fire with the orphan-recovery hook.
    const timer = setTimeout(hydrateOnce, 600);

    // Re-hydrate whenever the customer activates a (new) code.
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (
        state.activationCode &&
        state.activationCode !== prev.activationCode
      ) {
        hydrateOnce();
      }
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
