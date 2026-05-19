/**
 * API key lifecycle: mint → hash → validate.
 *
 * Plaintext shape: `sk_<28-char base64url>`. Only the SHA-256 digest
 * is persisted; plaintext is shown once at mint time then forgotten.
 * Lookup is by hash so a leaked DB doesn't expose live keys.
 *
 * Each API key links to an activation_codes row via `code_id`, so the
 * existing balance/charge/refund pipeline is reused unchanged — the
 * route handler resolves API key → codeId, then everything downstream
 * (validateCode, chargeCode, usage_logs) flows like the web UI auth.
 */

import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiKeys, activationCodes } from "@/lib/db/schema";
import { validateCode, type CodeMetadata } from "@/lib/auth/activation";

/** Plaintext API key prefix — helps customers identify the key shape. */
const PLAINTEXT_PREFIX = "sk_";
/** 21 random bytes → ~28-char base64url. Roughly 168 bits of entropy. */
const KEY_BYTES = 21;

/** Generate a fresh plaintext key — caller must hash + persist + show ONCE. */
export function mintApiKey(): { plaintext: string; hash: string } {
  const random = randomBytes(KEY_BYTES).toString("base64url");
  const plaintext = `${PLAINTEXT_PREFIX}${random}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

/** SHA-256 hex digest of the plaintext key. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export type ApiKeyValidationFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "inactive" }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "code_invalid"; codeReason: "not_found" | "inactive" | "expired" };

export interface ApiKeyValidationSuccess {
  ok: true;
  /** API key row identity — used for per-key rate-limit scope. */
  apiKeyId: string;
  apiKeyLabel: string;
  /** Override rate limit (req/min); null = inherit endpoint default. */
  rateLimitPerMin: number | null;
  /** Activation code metadata — billing flows through this. */
  metadata: CodeMetadata;
}

export type ApiKeyValidationResult =
  | ApiKeyValidationSuccess
  | ApiKeyValidationFailure;

/**
 * Validate a plaintext API key + return the linked activation code's
 * metadata so the route handler can charge/refund without a second
 * DB lookup. Touches `last_used_at` on success (best-effort, errors
 * don't block the call).
 */
export async function validateApiKey(
  plaintext: string,
): Promise<ApiKeyValidationResult> {
  if (!plaintext || !plaintext.startsWith(PLAINTEXT_PREFIX)) {
    return { ok: false, reason: "not_found" };
  }
  const hash = hashApiKey(plaintext);

  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      codeId: apiKeys.codeId,
      isActive: apiKeys.isActive,
      expiresAt: apiKeys.expiresAt,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      // Inline join: reuse the activation code's raw fields so we can
      // hand them to validateCode-equivalent logic without a 2nd query.
      codeText: activationCodes.code,
    })
    .from(apiKeys)
    .innerJoin(activationCodes, eq(activationCodes.id, apiKeys.codeId))
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  const [row] = rows;
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.isActive) return { ok: false, reason: "inactive" };
  if (row.expiresAt) {
    const expiresMs =
      row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : Date.parse(String(row.expiresAt));
    if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
  }

  // Now validate the linked activation code. Reuse validateCode so the
  // mode/quota/expiry logic stays in one place.
  const codeValidation = await validateCode(row.codeText);
  if (!codeValidation.ok) {
    return {
      ok: false,
      reason: "code_invalid",
      codeReason: codeValidation.reason,
    };
  }

  // Stamp last_used_at — fire-and-forget; failure here shouldn't block
  // the auth path.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return {
    ok: true,
    apiKeyId: row.id,
    apiKeyLabel: row.label,
    rateLimitPerMin: row.rateLimitPerMin,
    metadata: codeValidation.metadata,
  };
}

/**
 * Extract API key from `Authorization: Bearer sk_...` header. Returns
 * null when missing/malformed so route handlers can return 401.
 */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const token = match[1];
  if (!token || !token.startsWith(PLAINTEXT_PREFIX)) return null;
  return token;
}

