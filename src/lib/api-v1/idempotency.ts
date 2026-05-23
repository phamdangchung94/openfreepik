/**
 * Idempotency-Key cache for /api/v1/* POST endpoints.
 *
 * Stripe-style semantics:
 *   - Customer sends `Idempotency-Key: <unique-string>` header
 *   - Server caches the response for 24h
 *   - Same key + same body → replay cached response (no re-processing)
 *   - Same key + DIFFERENT body → 409 IDEMPOTENCY_CONFLICT
 *   - No key → normal processing
 *
 * Why customers want this: a network retry shouldn't double-charge.
 * If they POST /v1/video/kling-3 with idempotency-key=X and timeout,
 * retrying with the same key returns the original task_id instead of
 * starting a second generation (and second charge).
 *
 * Storage: `idempotency_keys` table keyed by (api_key_id,
 * idempotency_key). Cron sweeper cleans expired rows.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { idempotencyKeys } from "@/lib/db/schema";
import { apiError } from "./response";
import { errFields, log } from "@/lib/logger";

const TTL_HOURS = 24;
const MAX_KEY_LENGTH = 255;

/**
 * Best-effort cleanup of expired idempotency rows. Called daily by
 * the purge cron alongside other table cleanups.
 */
export async function purgeExpiredIdempotencyKeys(): Promise<void> {
  try {
    await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()));
  } catch (err) {
    log.warn("IDEMPOTENCY_PURGE_FAILED", { ...errFields(err) });
  }
}

/** Lift the `Idempotency-Key` header off a request. Case-insensitive. */
export function extractIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) return null;
  return trimmed;
}

/** Stable hash of a body for body-mismatch detection on key reuse. */
export function hashRequestBody(body: unknown): string {
  // JSON.stringify is deterministic for the inputs we care about
  // (zod-validated JSON with primitive/array/object types). Sorting
  // keys would be more robust but adds complexity for marginal value.
  const serialized = body === undefined ? "" : JSON.stringify(body);
  return createHash("sha256").update(serialized).digest("hex");
}

export interface CachedResponse {
  status: number;
  body: unknown;
}

/**
 * Look up a previously-cached response for this (apiKeyId, key) pair.
 * Returns:
 *   - null: no cached response — caller should process normally
 *   - {hit: true, response}: cached response found, body matched →
 *     caller should return cached.response directly
 *   - {hit: false, conflict: true}: cached response found but body
 *     hash mismatch → caller should return 409
 *
 * Reads are best-effort. If the lookup throws (DB hiccup), we log + skip
 * idempotency for this request rather than failing the customer's call.
 */
export type IdempotencyLookup =
  | { hit: true; response: CachedResponse }
  | { hit: false; conflict: true }
  | null;

export async function lookupIdempotent(
  apiKeyId: string,
  idempotencyKey: string,
  bodyHash: string,
): Promise<IdempotencyLookup> {
  try {
    const [row] = await db
      .select({
        requestBodyHash: idempotencyKeys.requestBodyHash,
        responseStatus: idempotencyKeys.responseStatus,
        responseBody: idempotencyKeys.responseBody,
        expiresAt: idempotencyKeys.expiresAt,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.apiKeyId, apiKeyId),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (!row) return null;

    // Lazy expiry — if the row is past TTL, treat as miss. Cron sweeper
    // physically deletes; this guard handles the gap.
    const expiresMs =
      row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : Date.parse(String(row.expiresAt));
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
      return null;
    }

    if (row.requestBodyHash !== bodyHash) {
      return { hit: false, conflict: true };
    }
    return {
      hit: true,
      response: {
        status: row.responseStatus,
        body: row.responseBody,
      },
    };
  } catch (err) {
    log.warn("IDEMPOTENCY_LOOKUP_FAILED", {
      apiKeyId,
      ...errFields(err),
    });
    return null;
  }
}

/**
 * Persist a fresh response under the (apiKeyId, key) PK. Best-effort —
 * INSERT ... ON CONFLICT DO NOTHING so two concurrent first-time
 * requests don't both insert (one wins, the other silently no-ops).
 */
export async function persistIdempotent(
  apiKeyId: string,
  idempotencyKey: string,
  bodyHash: string,
  response: CachedResponse,
): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);
  try {
    await db
      .insert(idempotencyKeys)
      .values({
        apiKeyId,
        idempotencyKey,
        requestBodyHash: bodyHash,
        responseStatus: response.status,
        responseBody: response.body as object,
        expiresAt,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.warn("IDEMPOTENCY_PERSIST_FAILED", {
      apiKeyId,
      ...errFields(err),
    });
  }
}

/**
 * Build the standard 409 response for body-mismatch on key reuse.
 * Helper because two routes return this same shape.
 */
export function idempotencyConflictResponse(
  requestId: string,
): NextResponse {
  return apiError({
    status: 409,
    error: "IDEMPOTENCY_CONFLICT",
    message:
      "Idempotency-Key was previously used with a different request body. Use a new key or send the same body as before.",
    requestId,
  });
}

/**
 * Begin/commit pattern for inline use in route handlers — encapsulates
 * key extraction + lookup + persistence so the route code stays clean.
 *
 * Usage:
 *   const idem = await beginIdempotency(request, body, auth);
 *   if (idem.replay) return idem.replay;       // cached or conflict
 *   // … normal processing …
 *   const response = { status: 200, body: {ok: true, task_id: "..."} };
 *   await idem.commit(response);
 *   return NextResponse.json(response.body, { status: response.status });
 *
 * If no Idempotency-Key header, idem.replay is null and idem.commit
 * is a no-op — route runs normally with zero extra DB writes.
 */
export interface IdempotencyHandle {
  /** Set when we have a cached response OR a body-mismatch 409. */
  replay: NextResponse | null;
  /** Call before returning success. No-op when no key was provided. */
  commit: (response: CachedResponse) => Promise<void>;
}

export async function beginIdempotency(
  request: Request,
  body: unknown,
  auth: { apiKeyId: string; requestId: string },
): Promise<IdempotencyHandle> {
  const key = extractIdempotencyKey(request);
  if (!key) {
    return { replay: null, commit: async () => {} };
  }
  const bodyHash = hashRequestBody(body);
  const lookup = await lookupIdempotent(auth.apiKeyId, key, bodyHash);
  if (lookup && "conflict" in lookup && lookup.conflict) {
    return {
      replay: idempotencyConflictResponse(auth.requestId),
      commit: async () => {},
    };
  }
  if (lookup && lookup.hit) {
    return {
      replay: NextResponse.json(lookup.response.body, {
        status: lookup.response.status,
        headers: {
          "x-request-id": auth.requestId,
          "idempotent-replayed": "true",
        },
      }),
      commit: async () => {},
    };
  }
  // Fresh — caller proceeds. Commit on success.
  return {
    replay: null,
    commit: (response) =>
      persistIdempotent(auth.apiKeyId, key, bodyHash, response),
  };
}
