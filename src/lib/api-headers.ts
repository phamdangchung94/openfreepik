/**
 * Client-side helper to build fetch headers with the user's API key.
 * Reads from Zustand store (works in async contexts outside React).
 */

import { useTaskStore } from "@/store/task-store";

/** Returns headers object with the API key for client→server fetch calls. */
export function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const { apiKey } = useTaskStore.getState();
  return {
    "content-type": "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
    ...extra,
  };
}
