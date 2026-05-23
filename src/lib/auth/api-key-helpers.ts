import { NextResponse } from "next/server";
import {
  extractApiKey,
  validateApiKey,
  type ApiKeyValidationSuccess,
} from "@/lib/auth/api-key";
import type { ValidationResult } from "@/lib/auth/activation";
import { apiError, newRequestId } from "@/lib/api-v1/response";

/**
 * Auth gate for /api/v1/* routes. Returns either:
 *   - a NextResponse (401) if auth failed — route should return it
 *   - the resolved API key + activation code metadata + request_id
 *
 * Route pattern:
 *   const auth = await requireApiKey(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // …auth.preValidated, auth.apiKeyId, auth.metadata, auth.requestId…
 *
 * `requestId` is generated here so every /v1/* response (auth-failed
 * or otherwise) carries one. Routes thread it through apiError /
 * apiSuccess helpers (lib/api-v1/response) so customers can quote it
 * in support tickets.
 */
export async function requireApiKey(
  request: Request,
): Promise<NextResponse | ApiKeyAuthSuccess> {
  const requestId = newRequestId();

  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return apiError({
      status: 401,
      error: "AUTH",
      message:
        "Missing Authorization header. Use `Authorization: Bearer sk_...`",
      requestId,
    });
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
    return apiError({
      status: 401,
      error: "AUTH",
      message: messages[result.reason] ?? "Auth failed.",
      requestId,
    });
  }

  // Wrap the activation code metadata in a ValidationResult so the
  // orchestrator's preValidated path accepts it verbatim.
  const preValidated: ValidationResult = {
    ok: true,
    metadata: result.metadata,
  };

  return { ...result, preValidated, requestId };
}

export interface ApiKeyAuthSuccess extends ApiKeyValidationSuccess {
  /** Wraps metadata for orchestrator.preValidated. */
  preValidated: ValidationResult;
  /**
   * Per-request UUID — propagate to apiSuccess/apiError so the
   * customer-facing response includes x-request-id header (and
   * request_id field in errors) for support traceability.
   */
  requestId: string;
}
