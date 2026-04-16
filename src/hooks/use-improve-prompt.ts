"use client";

import { useState, useCallback, useRef } from "react";
import { getApiHeaders, extractErrorMessage } from "@/lib/api-headers";
import { useTaskPolling, type PollingStatus } from "./use-task-polling";

interface UseImprovePromptResult {
  improve: (prompt: string) => Promise<void>;
  reset: () => void;
  status: PollingStatus;
  result: string | null;
  originalPrompt: string;
  isLoading: boolean;
}

async function fetchTaskStatus(taskId: string) {
  const res = await fetch(`/api/freepik/improve-prompt/${taskId}`, {
    headers: getApiHeaders(),
  });
  if (!res.ok) {
    const errMsg = await extractErrorMessage(res);
    throw new Error(errMsg);
  }
  const json = await res.json();
  return json.data as { status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED"; generated: string[] };
}

export function useImprovePrompt(): UseImprovePromptResult {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const fetcherRef = useRef(fetchTaskStatus);

  const polling = useTaskPolling({
    taskId,
    fetcher: fetcherRef.current,
    intervalMs: 1500,
    maxTimeMs: 60000,
    enabled: taskId !== null,
    onCompleted: (generated) => {
      // The generated array contains the improved prompt text
      const improved = generated[0];
      if (improved) {
        setResult(improved);
      }
    },
  });

  const improve = useCallback(async (prompt: string) => {
    setOriginalPrompt(prompt);
    setResult(null);
    setTaskId(null);

    const res = await fetch("/api/freepik/improve-prompt", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ prompt, type: "video", language: "en" }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    setTaskId(json.data.task_id);
  }, []);

  const reset = useCallback(() => {
    setTaskId(null);
    setResult(null);
    setOriginalPrompt("");
  }, []);

  const isLoading =
    polling.status === "CREATED" || polling.status === "IN_PROGRESS";

  return {
    improve,
    reset,
    status: polling.status,
    result,
    originalPrompt,
    isLoading,
  };
}
