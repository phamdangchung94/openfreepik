/**
 * Detect when the customer is retrying the same input that keeps
 * failing upstream. Observed in production 2026-05-12: one customer
 * fired 11 identical 8s+audio prompts in 12 minutes, all rejected by
 * the upstream renderer with the same content-policy reason. They
 * almost certainly didn't realise the prompt was the problem — the
 * generic "Failed" badge on every retry looks like a transient blip.
 *
 * This module supplies a pre-flight check the form runs BEFORE
 * dispatching a new generation: if the same (mode, prompt, image)
 * has failed `THRESHOLD` times within `WINDOW_MS`, surface a warning
 * banner so the customer can either tweak the input or proceed
 * deliberately. We never hard-block — false positives are possible
 * (e.g. legit transient outages), and the user should keep agency.
 */

import type { GenerationTask } from "@/store/task-store";

/** How many identical recent failures we need before warning. */
const THRESHOLD = 3;

/** Look-back window. 10 min is generous — covers the typical retry
 * cluster while excluding stale history from earlier sessions. */
const WINDOW_MS = 10 * 60_000;

export interface RepeatFailureCheckInput {
  prompt: string;
  mode: "t2v" | "i2v";
  imageUrl?: string;
  /** Object map straight from the Zustand store. */
  tasks: Record<string, GenerationTask>;
}

export interface RepeatFailureResult {
  shouldWarn: boolean;
  failedCount: number;
  /** Most-recent matching failure (for showing time-since in the toast). */
  latestFailedAt: number | null;
}

/**
 * Normalise input to a comparison key. We strip leading/trailing
 * whitespace but otherwise treat the prompt as exact-match — the
 * point is "is THIS input failing repeatedly", not fuzzy similarity.
 */
function fingerprint(
  mode: "t2v" | "i2v",
  prompt: string,
  imageUrl?: string,
): string {
  return [mode, prompt.trim(), imageUrl ?? ""].join("");
}

export function checkRecentRepeatFailures(
  input: RepeatFailureCheckInput,
): RepeatFailureResult {
  const wanted = fingerprint(input.mode, input.prompt, input.imageUrl);
  const cutoff = Date.now() - WINDOW_MS;

  let failedCount = 0;
  let latestFailedAt: number | null = null;

  for (const task of Object.values(input.tasks)) {
    if (task.createdAt < cutoff) continue;
    // Only count terminal-failure states. CANCELLED is user-initiated
    // so it doesn't signal "input is bad". TIMEOUT might indicate
    // upstream slowness rather than content rejection so we exclude it
    // too — too noisy. Pure FAILED is the strong signal.
    if (task.status !== "FAILED") continue;
    const taskMode = task.mode;
    const taskFingerprint = fingerprint(
      taskMode,
      task.prompt ?? "",
      task.imageUrl ?? undefined,
    );
    if (taskFingerprint !== wanted) continue;
    failedCount++;
    if (latestFailedAt === null || task.createdAt > latestFailedAt) {
      latestFailedAt = task.createdAt;
    }
  }

  return {
    shouldWarn: failedCount >= THRESHOLD,
    failedCount,
    latestFailedAt,
  };
}
