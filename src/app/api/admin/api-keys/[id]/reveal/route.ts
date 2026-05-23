import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/admin/api-keys/[id]/reveal
 *
 * Admin-only — return the plaintext sk_* by decrypting key_encrypted.
 * Audit-logged (API_KEY_PLAINTEXT_VIEWED) so admin actions are
 * traceable. Returns 404 for legacy keys (encrypted column NULL —
 * minted before migration 0018, only hash on hand).
 *
 * No body or path-param validation beyond what `[id]` provides:
 *   - non-uuid id → just returns 404 silently via WHERE no-match
 *   - admin auth comes from session cookie via requireAdminApi
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "id required" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      keyEncrypted: apiKeys.keyEncrypted,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "API key không tồn tại." },
      { status: 404 },
    );
  }

  if (!row.keyEncrypted) {
    // Legacy key — created before migration 0018. We only have the
    // hash, the plaintext is gone forever. Admin must revoke + mint
    // a replacement to get a viewable key.
    return NextResponse.json(
      {
        ok: false,
        error: "NO_PLAINTEXT",
        message:
          "Key này được tạo trước khi tính năng lưu plaintext bật. Mint key mới cho customer để có plaintext xem được.",
      },
      { status: 410 },
    );
  }

  let plaintext: string;
  try {
    plaintext = await decrypt(row.keyEncrypted);
  } catch (err) {
    log.error("API_KEY_DECRYPT_FAILED", {
      id: row.id,
      label: row.label,
      ...errFields(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "DECRYPT_FAILED",
        message:
          "Không thể decrypt — có thể KEY_ENCRYPTION_SECRET đã đổi. Mint key mới.",
      },
      { status: 500 },
    );
  }

  log.info("API_KEY_PLAINTEXT_VIEWED", {
    id: row.id,
    label: row.label,
  });

  return NextResponse.json({ ok: true, plaintext, label: row.label });
}
