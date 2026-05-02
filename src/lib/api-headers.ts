/**
 * Client-side helpers for activation-code auth and fetch headers.
 * Reads from Zustand store (works in async contexts outside React).
 */

import { useAuthStore } from "@/store/auth-store";

/** Returns headers object with the bearer activation code for client→server fetch calls. */
export function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const { activationCode } = useAuthStore.getState();
  return {
    "content-type": "application/json",
    ...(activationCode ? { Authorization: `Bearer ${activationCode}` } : {}),
    ...extra,
  };
}

/** Returns the current activation code or throws if missing. */
export function requireActivationCode(): string {
  const { activationCode } = useAuthStore.getState();
  if (!activationCode) {
    throw new Error(
      "Activation code is required. Please activate your code first.",
    );
  }
  return activationCode;
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
