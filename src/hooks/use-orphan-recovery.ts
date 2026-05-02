"use client";

import { useEffect } from "react";
import { useTaskStore } from "@/store/task-store";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";

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
    });
  } else {
    useTaskStore.getState().updateTask(localId, {
      status: result.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
      error: `${result.error ?? "Generation failed"} (recovered)`,
    });
  }
}

// Module-level guard — survives React Strict Mode double-mount
let recovered = false;

export function useOrphanRecovery() {
  useEffect(() => {
    if (recovered) return;
    recovered = true;

    // Wait a tick for Zustand to hydrate from localStorage
    const timer = setTimeout(() => {
      const { tasks } = useTaskStore.getState();
      const orphans = Object.values(tasks).filter(
        (t) =>
          (t.status === "IN_PROGRESS" || t.status === "CREATED") &&
          t.taskId !== null
      );

      if (orphans.length === 0) return;

      console.log(
        `[orphan-recovery] Found ${orphans.length} orphaned task(s), resuming polling...`
      );

      for (const task of orphans) {
        recoverTask(task.id, task.taskId!);
      }

      // Tasks without taskId (CREATED but never submitted) — mark as failed
      const noApiId = Object.values(tasks).filter(
        (t) => t.status === "CREATED" && t.taskId === null
      );
      for (const task of noApiId) {
        useTaskStore.getState().updateTask(task.id, {
          status: "FAILED",
          error: "Interrupted before submission — please regenerate",
        });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);
}
