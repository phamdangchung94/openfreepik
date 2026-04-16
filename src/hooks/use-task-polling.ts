"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TaskStatus } from "@/lib/freepik/types";

export type PollingStatus = TaskStatus | "IDLE" | "TIMEOUT";

interface UseTaskPollingOptions {
  taskId: string | null;
  fetcher: (taskId: string) => Promise<{ status: TaskStatus; generated: string[] }>;
  intervalMs?: number;
  maxTimeMs?: number;
  enabled?: boolean;
  onCompleted?: (generated: string[]) => void;
  onFailed?: (error: string) => void;
}

interface UseTaskPollingResult {
  status: PollingStatus;
  generated: string[];
  cancel: () => void;
}

export function useTaskPolling(opts: UseTaskPollingOptions): UseTaskPollingResult {
  const {
    taskId,
    fetcher,
    intervalMs = 2000,
    maxTimeMs = 600000,
    enabled = true,
  } = opts;

  const [status, setStatus] = useState<PollingStatus>("IDLE");
  const [generated, setGenerated] = useState<string[]>([]);
  const cancelledRef = useRef(false);
  const startTimeRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attemptRef = useRef(0);

  // Store callbacks in refs to avoid re-triggering the effect
  const onCompletedRef = useRef(opts.onCompleted);
  onCompletedRef.current = opts.onCompleted;
  const onFailedRef = useRef(opts.onFailed);
  onFailedRef.current = opts.onFailed;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus("IDLE");
  }, []);

  useEffect(() => {
    if (!taskId || !enabled) {
      setStatus("IDLE");
      return;
    }

    cancelledRef.current = false;
    startTimeRef.current = Date.now();
    attemptRef.current = 0;
    setStatus("CREATED");
    setGenerated([]);

    async function poll() {
      if (cancelledRef.current || !taskId) return;

      if (Date.now() - startTimeRef.current > maxTimeMs) {
        setStatus("TIMEOUT");
        onFailedRef.current?.("Polling timed out");
        return;
      }

      try {
        const result = await fetcherRef.current(taskId);
        if (cancelledRef.current) return;

        setStatus(result.status);

        if (result.status === "COMPLETED") {
          setGenerated(result.generated);
          onCompletedRef.current?.(result.generated);
          return;
        }

        if (result.status === "FAILED") {
          onFailedRef.current?.("Generation failed");
          return;
        }

        attemptRef.current++;
        const delay = Math.min(
          intervalMs + attemptRef.current * 500,
          10000
        );
        timeoutRef.current = setTimeout(poll, delay);
      } catch {
        if (cancelledRef.current) return;
        attemptRef.current++;
        const delay = Math.min(intervalMs * 2, 10000);
        timeoutRef.current = setTimeout(poll, delay);
      }
    }

    poll();

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [taskId, enabled, intervalMs, maxTimeMs]);

  return { status, generated, cancel };
}
