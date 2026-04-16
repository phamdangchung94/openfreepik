/**
 * Low-level HTTP wrapper for the Freepik API.
 * Every endpoint function calls `request()` — it attaches the API key,
 * handles errors, and returns typed JSON.
 */

import { FreepikApiError, type InvalidParam } from "./errors";

const FREEPIK_BASE_URL = "https://api.freepik.com";

export async function request<T>(opts: {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  apiKey: string;
}): Promise<T> {
  const { method, path, body, query, apiKey } = opts;

  if (!apiKey) {
    throw new FreepikApiError({
      message: "API key is required. Please enter your Freepik API key.",
      code: "AUTH",
      status: 401,
    });
  }

  const url = new URL(path, FREEPIK_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "x-freepik-api-key": apiKey,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new FreepikApiError({
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      code: "NETWORK",
      status: 0,
    });
  }

  // Parse response body (best-effort JSON)
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw mapHttpError(res.status, null);
    }
    throw new FreepikApiError({
      message: "Freepik returned a non-JSON response.",
      code: "INVALID_RESPONSE",
      status: res.status,
    });
  }

  if (!res.ok) {
    throw mapHttpError(res.status, json);
  }

  return json as T;
}

function mapHttpError(status: number, body: unknown): FreepikApiError {
  const msg = extractMessage(body);
  const invalidParams = extractInvalidParams(body);

  if (status === 401) {
    return new FreepikApiError({
      message: msg || "Invalid or missing API key.",
      code: "AUTH",
      status,
    });
  }
  if (status === 400) {
    return new FreepikApiError({
      message: msg || "Bad request — check your parameters.",
      code: "BAD_REQUEST",
      status,
      invalidParams,
    });
  }
  if (status === 429) {
    return new FreepikApiError({
      message: msg || "Rate limit exceeded. Try again shortly.",
      code: "RATE_LIMIT",
      status,
    });
  }
  if (status >= 500) {
    return new FreepikApiError({
      message: msg || "Freepik server error. Try again later.",
      code: "SERVER",
      status,
    });
  }
  return new FreepikApiError({
    message: msg || `Unexpected HTTP ${status}`,
    code: "UNKNOWN",
    status,
  });
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body) {
    return String((body as Record<string, unknown>).message);
  }
  return undefined;
}

function extractInvalidParams(body: unknown): InvalidParam[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  // Freepik sometimes wraps in { problem: { invalid_params: [...] } }
  const source =
    (b.invalid_params as unknown[]) ??
    ((b.problem as Record<string, unknown> | undefined)
      ?.invalid_params as unknown[]);

  if (!Array.isArray(source)) return [];
  return source
    .filter(
      (p): p is { name: string; reason: string } =>
        typeof p === "object" &&
        p !== null &&
        "name" in p &&
        "reason" in p
    )
    .map((p) => ({ name: String(p.name), reason: String(p.reason) }));
}
