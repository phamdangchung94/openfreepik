import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { decrypt, encrypt } from "@/lib/crypto/aes-gcm";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/admin/api-keys/[id]/webhook-secret
 *   → decrypt + return plaintext whsec_*. Used by admin "Xem secret"
 *     button on the API token card.
 *
 * POST /api/admin/api-keys/[id]/webhook-secret
 *   → generate a NEW random secret, replace the stored one, return
 *     plaintext ONCE. Used for rotation + for upgrading legacy keys
 *     that have NULL webhook_secret_encrypted (pre-migration 0019).
 *
 * Both routes audit-log so admin actions on customer secrets stay
 * traceable.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [row] = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      webhookSecretEncrypted: apiKeys.webhookSecretEncrypted,
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

  if (!row.webhookSecretEncrypted) {
    return NextResponse.json(
      {
        ok: false,
        error: "NO_WEBHOOK_SECRET",
        message:
          "Key này chưa có webhook secret (legacy, trước migration 0019). Bấm Regenerate để tạo mới.",
      },
      { status: 410 },
    );
  }

  let plaintext: string;
  try {
    plaintext = await decrypt(row.webhookSecretEncrypted);
  } catch (err) {
    log.error("WEBHOOK_SECRET_DECRYPT_FAILED", {
      id: row.id,
      label: row.label,
      ...errFields(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "DECRYPT_FAILED",
        message: "Không decrypt được — Regenerate để có secret mới.",
      },
      { status: 500 },
    );
  }

  log.info("WEBHOOK_SECRET_VIEWED", { id: row.id, label: row.label });
  return NextResponse.json({ ok: true, webhookSecret: plaintext, label: row.label });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [existing] = await db
    .select({ id: apiKeys.id, label: apiKeys.label })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "API key không tồn tại." },
      { status: 404 },
    );
  }

  const fresh = `whsec_${randomBytes(32).toString("base64url")}`;
  let encrypted: string;
  try {
    encrypted = await encrypt(fresh);
  } catch (err) {
    log.error("WEBHOOK_SECRET_ENCRYPT_FAILED", {
      id,
      ...errFields(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "ENCRYPT_FAILED",
        message: "Không thể encrypt secret — kiểm tra KEY_ENCRYPTION_SECRET.",
      },
      { status: 500 },
    );
  }

  await db
    .update(apiKeys)
    .set({ webhookSecretEncrypted: encrypted })
    .where(eq(apiKeys.id, id));

  log.info("WEBHOOK_SECRET_ROTATED", { id, label: existing.label });
  return NextResponse.json({
    ok: true,
    webhookSecret: fresh,
    label: existing.label,
    note: "Lưu secret ngay — paste vào customer's webhook verify env var. Secret cũ đã bị invalidated.",
  });
}
