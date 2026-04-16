/**
 * Client-side helpers for API key management and fetch headers.
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

/** Returns the current API key or throws if missing. */
export function requireApiKey(): string {
  const { apiKey } = useTaskStore.getState();
  if (!apiKey) {
    throw new Error("API key is required. Please enter your Freepik API key.");
  }
  return apiKey;
}

/**
 * Extract a human-readable error message from a failed fetch response.
 * Falls back to "HTTP {status}" if body can't be parsed.
 */
export async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json.message || json.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
