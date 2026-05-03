"use client";

import { getApiHeaders } from "@/lib/api-headers";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";

/**
 * Submit a prompt to Freepik's improve-prompt endpoint and poll
 * until the enhanced version is ready. Falls back to the original
 * prompt on any failure (network, FAILED status, timeout, empty input).
 */
export async function enhancePromptOnce(prompt: string): Promise<string> {
  if (!prompt.trim()) return prompt;

  try {
    const res = await fetch("/api/freepik/improve-prompt", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ prompt, type: "video", language: "en" }),
    });
    if (!res.ok) return prompt;

    const { data } = await res.json();
    const taskId = data.task_id as string;

    const result = await pollTaskUntilDone({
      apiTaskId: taskId,
      endpoint: "improve-prompt",
      maxTimeMs: 60_000,
    });

    if (result.status === "COMPLETED") {
      return result.generated[0] ?? prompt;
    }
    return prompt;
  } catch (err) {
    console.warn("[enhancePrompt] failed, falling back to original:", err);
    return prompt;
  }
}
