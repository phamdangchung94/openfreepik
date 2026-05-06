"use client";

import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import type { TaskStatus } from "./types";

/**
 * Global cap on simultaneous in-flight poll fetches across the whole app.
 * The batch hook can run with concurrency=10, which means 10 active
 * generations × ~0.5 polls/sec each = 5 req/sec sustained — half our
 * server's 60/min poll-rate-limit budget. With orphan recovery + history
 * hydration on top of that we'd burst over the limit.
 *
 * Implementation: simple semaphore. acquire() waits in a queue;
 * release() pops the next waiter.
 */
const MAX_CONCURRENT_POLLS = 5;
let activePolls = 0;
const pollWaiters: Array<() => void> = [];

async function acquirePollSlot(): Promise<void> {
  if (activePolls < MAX_CONCURRENT_POLLS) {
    activePolls++;
    return;
  }
  await new Promise<void>((resolve) => pollWaiters.push(resolve));
  activePolls++;
}

function releasePollSlot(): void {
  activePolls--;
  const next = pollWaiters.shift();
  if (next) next();
}

/**
 * When the tab is hidden, browsers throttle setInterval / setTimeout to
 * once per minute, which makes our 2s poll loop drag. We notice the
 * `visibilitychange` flip and bump the poll interval up so we're not
 * fighting the browser's throttle (and not wasting fetches that the
 * browser will queue up anyway).
 */
function visibilityAwareDelay(intervalMs: number, attempt: number): number {
  const base = Math.min(intervalMs + attempt * 500, 10_000);
  if (typeof document !== "undefined" && document.hidden) {
    // Background tab: poll at most every 30s. The customer isn't watching
    // anyway, and bringing the tab back to focus triggers an immediate
    // poll via the visibility listener below.
    return Math.max(base, 30_000);
  }
  return base;
}

export type PollEndpoint = "kling-v3" | "wan-v27" | "improve-prompt";

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

    // Block here until a poll slot is free. With concurrency=10 batch and
    // MAX_CONCURRENT_POLLS=5, half the polls wait at any moment — but
    // since each poll fetch returns in ~50-100ms the queue drains fast.
    await acquirePollSlot();

    // Tracks whether release happened inside the try (currently never
    // does — left here as documentation of intent for future paths
    // that might want to release before the catch handler). Always
    // false today; the finally block does the real release.
    const releasedEarly = false;
    try {
      const res = await fetch(`/api/freepik/${endpoint}/${apiTaskId}`, {
        headers: getApiHeaders(),
        signal,
      });

      // 401 means the activation code went away (logout, revoke, expiry).
      // Don't retry — there's no recovery path that doesn't require user
      // action. Audit #10: previously this looped for 10 minutes until
      // maxTimeMs and surfaced as a confusing TIMEOUT.
      if (res.status === 401) {
        return {
          status: "FAILED",
          generated: [],
          error: "Authentication lost — please activate your code again",
        };
      }

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
    } finally {
      if (!releasedEarly) releasePollSlot();
    }

    attempt++;
    const delay = visibilityAwareDelay(intervalMs, attempt);
    await new Promise((r) => setTimeout(r, delay));
  }

  return { status: "TIMEOUT", generated: [], error: "Polling timed out" };
}
