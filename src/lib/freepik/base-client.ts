/**
 * Low-level HTTP wrapper for the Magnific/Freepik API.
 * Every endpoint function calls `request()` — it attaches the API key,
 * handles errors, and returns typed JSON.
 *
 * Default host is Magnific (post-2024 acquisition; Magnific-issued keys
 * are rejected at api.freepik.com with 401 "Invalid API key"). Override
 * with FREEPIK_API_BASE_URL / FREEPIK_API_KEY_HEADER env vars if you
 * ever need to revert to api.freepik.com without redeploying.
 */

import { FreepikApiError, type InvalidParam } from "./errors";

const API_BASE_URL = process.env.FREEPIK_API_BASE_URL ?? "https://api.magnific.com";
const API_KEY_HEADER = process.env.FREEPIK_API_KEY_HEADER ?? "x-magnific-api-key";

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

  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    [API_KEY_HEADER]: apiKey,
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
  if (status === 402) {
    return new FreepikApiError({
      message: msg || "Freepik account is out of credit.",
      code: "QUOTA_EXHAUSTED",
      status,
    });
  }
  if (status === 403) {
    // Freepik / Magnific returns 403 for several distinct reasons:
    //   1. Plan-level usage limit reached on the upstream account.
    //      Message looks like: "Hello! You've reached the default usage
    //      limit of your Magnific API plan. ..."
    //      → key is FINE, just temporarily over its plan ceiling. We
    //        should rotate to the next key but NOT permanently mark
    //        this one inactive (it'll work again on plan reset).
    //   2. Bad request body (missing/invalid field rejected at WAF
    //      rather than 400) → key fine, request is the problem;
    //      rotating would drain the entire pool over one bad payload.
    //   3. Account suspended / plan-gated / region-blocked
    //      → key is genuinely unusable; orchestrator should rotate
    //        AND mark inactive.
    if (invalidParams.length > 0) {
      return new FreepikApiError({
        message: msg || "Bad request — check your parameters.",
        code: "BAD_REQUEST",
        status,
        invalidParams,
      });
    }
    if (msg && /usage limit|api plan|plan limit/i.test(msg)) {
      return new FreepikApiError({
        message: msg,
        code: "PLAN_LIMIT",
        status,
      });
    }
    return new FreepikApiError({
      message: msg || "Freepik refused the request — key likely suspended or limited.",
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
    // Magnific uses HTTP 429 for two semantically different things:
    //   1. True rate-limit (transient — retry in a few seconds works)
    //   2. "Free trial usage exhausted" / "upgrade to paid plan" — this
    //      is permanent for the account until billing is upgraded;
    //      retrying a thousand times won't help, the key is dead.
    // Distinguish by message content. The free-trial path maps to
    // QUOTA_EXHAUSTED so isKeyExhaustedError flips is_active=false and
    // the key stops draining retry slots on every subsequent request.
    if (
      msg &&
      /free trial|free-tier|trial usage|upgrade.*paid|paid plan/i.test(msg)
    ) {
      return new FreepikApiError({
        message: msg,
        code: "QUOTA_EXHAUSTED",
        status,
      });
    }
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
