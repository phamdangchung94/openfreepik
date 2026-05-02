/** Shared helpers for Next.js API route handlers. */

import { NextResponse } from "next/server";
import { authedFreepikCall } from "./orchestrator";

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

interface TaskGetHandlerOptions<T> {
  /**
   * Best-effort side effect after a successful poll — used by kling-v3 to
   * write the video URL into usage_logs once Freepik reports COMPLETED.
   * Errors are swallowed: the customer's poll succeeds either way.
   */
  onSuccess?: (taskId: string, data: T) => Promise<void> | void;
}

/**
 * Build a GET handler for `/[taskId]` routes that polls Freepik task status.
 * Uses authedFreepikCall — validates the activation code and picks a key
 * from the pool, but doesn't charge or log (poll fires every few seconds).
 */
export function createTaskGetHandler<T>(
  getter: (taskId: string, opts: { apiKey: string }) => Promise<T>,
  options?: TaskGetHandlerOptions<T>,
) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ taskId: string }> },
  ) {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "taskId is required." },
        { status: 400 },
      );
    }

    const result = await authedFreepikCall({
      bearerCode: extractActivationCode(request),
      callFreepik: (apiKey) => getter(taskId, { apiKey }),
    });

    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    if (options?.onSuccess) {
      try {
        await options.onSuccess(taskId, result.data);
      } catch (err) {
        console.warn("[createTaskGetHandler] onSuccess hook failed:", err);
      }
    }

    return NextResponse.json({ data: result.data });
  };
}
