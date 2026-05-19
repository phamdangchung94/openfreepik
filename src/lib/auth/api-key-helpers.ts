import { NextResponse } from "next/server";
import {
  extractApiKey,
  validateApiKey,
  type ApiKeyValidationSuccess,
} from "@/lib/auth/api-key";
import type { ValidationResult } from "@/lib/auth/activation";

/**
 * Auth gate for /api/v1/* routes. Returns either:
 *   - a NextResponse (401) if auth failed — route should return it
 *   - the resolved API key + activation code metadata on success
 *
 * Route pattern:
 *   const auth = await requireApiKey(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // …auth.preValidated, auth.apiKeyId, auth.metadata…
 */
export async function requireApiKey(
  request: Request,
): Promise<NextResponse | ApiKeyAuthSuccess> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "AUTH",
        message:
          "Missing Authorization header. Use `Authorization: Bearer sk_...`",
      },
      { status: 401 },
    );
  }

  const result = await validateApiKey(apiKey);
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "Invalid API key.",
      inactive: "API key has been revoked.",
      expired: "API key has expired.",
      code_invalid:
        "API key valid but linked account is inactive/expired.",
    };
    return NextResponse.json(
      { ok: false, error: "AUTH", message: messages[result.reason] },
      { status: 401 },
    );
  }

  // Wrap the activation code metadata in a ValidationResult so the
  // orchestrator's preValidated path accepts it verbatim.
  const preValidated: ValidationResult = {
    ok: true,
    metadata: result.metadata,
  };

  return { ...result, preValidated };
}

export interface ApiKeyAuthSuccess extends ApiKeyValidationSuccess {
  /** Wraps metadata for orchestrator.preValidated. */
  preValidated: ValidationResult;
}
