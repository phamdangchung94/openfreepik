"use client";

import { useEffect } from "react";
import { useTaskStore } from "@/store/task-store";
import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import type { TaskStatus } from "@/lib/freepik/types";

/**
 * Recovers orphaned tasks on page load.
 *
 * When the page is reloaded or tab is closed during generation,
 * polling stops but tasks remain IN_PROGRESS in localStorage.
 * This hook detects those orphaned tasks and resumes polling.
 */

async function recoverTask(localId: string, apiTaskId: string) {
  const maxTime = 600_000;
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxTime) {
    try {
      const res = await fetch(`/api/freepik/kling-v3/${apiTaskId}`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) {
        const errMsg = await extractErrorMessage(res);
        throw new Error(errMsg);
      }
      const json = await res.json();
      const { status, generated } = json.data as {
        status: TaskStatus;
        generated: string[];
      };

      if (status === "COMPLETED") {
        const videoUrl = generated[0] ?? null;
        useTaskStore.getState().updateTask(localId, {
          status: "COMPLETED",
          videoUrl,
        });
        return;
      }
      if (status === "FAILED") {
        useTaskStore.getState().updateTask(localId, {
          status: "FAILED",
          error: "Generation failed (recovered)",
        });
        return;
      }
      // Still in progress — keep polling
    } catch {
      // Network error — retry
    }
    attempt++;
    const delay = Math.min(2_000 + attempt * 500, 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  useTaskStore.getState().updateTask(localId, {
    status: "TIMEOUT",
    error: "Polling timed out (recovered)",
  });
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
