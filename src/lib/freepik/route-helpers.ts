/** Shared helpers for Next.js API route handlers. */

import { NextResponse } from "next/server";
import { FreepikApiError } from "./errors";

/**
 * Maps any caught error to a proper NextResponse with status code.
 * Prevents leaking internal details or the API key.
 */
export function errorToResponse(err: unknown): NextResponse {
  if (err instanceof FreepikApiError) {
    return NextResponse.json(err.toJSON(), { status: err.status || 500 });
  }

  console.error("[freepik-route] Unexpected error:", err);
  return NextResponse.json(
    { error: "UNKNOWN", message: "An unexpected error occurred." },
    { status: 500 }
  );
}

/**
 * Parse JSON body from a NextRequest, returning null on failure.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Extract the user's Freepik API key from the request header.
 * Returns null if not present.
 *
 * @deprecated Will be removed in Phase 5 — replaced by extractActivationCode
 * once API routes switch to the activation-code auth model.
 */
export function extractApiKey(request: Request): string | null {
  return request.headers.get("x-api-key") || null;
}

/**
 * Extract a bearer-token activation code from the Authorization header.
 * Accepts: `Authorization: Bearer <code>` (case-insensitive scheme).
 * Returns null if missing or malformed.
 */
export function extractActivationCode(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const code = match?.[1]?.trim();
  return code && code.length > 0 ? code : null;
}

/**
 * Build a GET handler for `/[taskId]` routes that fetch task status
 * via a Freepik endpoint module's `getTask` function.
 */
export function createTaskGetHandler<T>(
  getter: (taskId: string, opts: { apiKey: string }) => Promise<T>,
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ taskId: string }> },
  ) {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "AUTH", message: "API key is required." },
        { status: 401 },
      );
    }

    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "taskId is required." },
        { status: 400 },
      );
    }

    try {
      const task = await getter(taskId, { apiKey });
      return NextResponse.json({ data: task });
    } catch (err) {
      return errorToResponse(err);
    }
  };
}
