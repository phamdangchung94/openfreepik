"use client";

import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import type { TaskStatus } from "./types";

export type PollEndpoint = "kling-v3" | "improve-prompt";

export interface PollTaskOptions {
  apiTaskId: string;
  endpoint: PollEndpoint;
  intervalMs?: number;
  maxTimeMs?: number;
  signal?: AbortSignal;
  onProgress?: (status: TaskStatus) => void;
}

export type PollFinalStatus = "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED";

export interface PollTaskResult {
  status: PollFinalStatus;
  generated: string[];
  error?: string;
}

/**
 * Long-poll a Freepik task until it terminates.
 * Used by fire-and-forget flows (single gen, batch, orphan recovery)
 * where a React hook lifecycle isn't available.
 */
export async function pollTaskUntilDone(
  opts: PollTaskOptions,
): Promise<PollTaskResult> {
  const {
    apiTaskId,
    endpoint,
    intervalMs = 2_000,
    maxTimeMs = 600_000,
    signal,
    onProgress,
  } = opts;

  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxTimeMs) {
    if (signal?.aborted) {
      return { status: "CANCELLED", generated: [], error: "cancelled" };
    }

    try {
      const res = await fetch(`/api/freepik/${endpoint}/${apiTaskId}`, {
        headers: getApiHeaders(),
        signal,
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));

      const json = await res.json();
      const { status, generated } = json.data as {
        status: TaskStatus;
        generated: string[];
      };

      onProgress?.(status);

      if (status === "COMPLETED") {
        return { status: "COMPLETED", generated: generated ?? [] };
      }
      if (status === "FAILED") {
        return { status: "FAILED", generated: [], error: "Generation failed" };
      }
    } catch (err) {
      if (signal?.aborted) {
        return { status: "CANCELLED", generated: [], error: "cancelled" };
      }
      console.warn(`[pollTask:${endpoint}] retry after error:`, err);
    }

    attempt++;
    const delay = Math.min(intervalMs + attempt * 500, 10_000);
    await new Promise((r) => setTimeout(r, delay));
  }

  return { status: "TIMEOUT", generated: [], error: "Polling timed out" };
}
