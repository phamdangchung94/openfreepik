"use client";

import { useEffect } from "react";
import { useTaskStore } from "@/store/task-store";
import { useAuthStore } from "@/store/auth-store";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";
import { expiresFromNow } from "@/lib/video-url-ttl";

/**
 * Recovers orphaned tasks on page load.
 *
 * When the page is reloaded or tab is closed during generation,
 * polling stops but tasks remain IN_PROGRESS in localStorage.
 * This hook detects those orphaned tasks and resumes polling.
 */

async function recoverTask(localId: string, apiTaskId: string) {
  const result = await pollTaskUntilDone({
    apiTaskId,
    endpoint: "kling-v3",
  });

  if (result.status === "COMPLETED") {
    useTaskStore.getState().updateTask(localId, {
      status: "COMPLETED",
      videoUrl: result.generated[0] ?? null,
      videoUrlExpiresAt: expiresFromNow(),
    });
  } else {
    useTaskStore.getState().updateTask(localId, {
      status: result.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
      error: `${result.error ?? "Generation failed"} (recovered)`,
    });
  }
}

// Track which task IDs we've already attempted to recover, so a re-trigger
// from auth-store changes (logout → re-login on the same tab) doesn't
// double-poll the same orphan. Survives React Strict Mode double-mount.
const recovering = new Set<string>();

function runRecovery() {
  // Audit #10: no bearer = bail. Authed-poll route would 401-loop and
  // surface as TIMEOUT. We just wait for an activation event and retry
  // on the next call to runRecovery.
  const { activationCode } = useAuthStore.getState();
  if (!activationCode) return;

  const { tasks } = useTaskStore.getState();
  const orphans = Object.values(tasks).filter(
    (t) =>
      (t.status === "IN_PROGRESS" || t.status === "CREATED") &&
      t.taskId !== null &&
      !recovering.has(t.id),
  );

  if (orphans.length > 0) {
    console.log(
      `[orphan-recovery] Found ${orphans.length} orphaned task(s), resuming polling...`,
    );
    for (const task of orphans) {
      recovering.add(task.id);
      recoverTask(task.id, task.taskId!).finally(() => {
        recovering.delete(task.id);
      });
    }
  }

  // Tasks without taskId (CREATED but never submitted) — mark as failed
  const noApiId = Object.values(tasks).filter(
    (t) => t.status === "CREATED" && t.taskId === null,
  );
  for (const task of noApiId) {
    useTaskStore.getState().updateTask(task.id, {
      status: "FAILED",
      error: "Interrupted before submission — please regenerate",
    });
  }
}

export function useOrphanRecovery() {
  useEffect(() => {
    // Initial sweep after Zustand hydration tick.
    const timer = setTimeout(runRecovery, 500);

    // Audit C7: when the customer logs out mid-task and re-activates on
    // the same tab, the initial sweep already ran. Subscribe to auth
    // changes so re-login also triggers recovery without a page reload.
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (state.activationCode && state.activationCode !== prev.activationCode) {
        runRecovery();
      }
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
