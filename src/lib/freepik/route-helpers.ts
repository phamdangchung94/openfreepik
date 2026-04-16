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
 */
export function extractApiKey(request: Request): string | null {
  return request.headers.get("x-api-key") || null;
}
