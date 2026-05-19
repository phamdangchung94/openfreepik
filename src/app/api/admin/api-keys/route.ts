import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, apiKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { mintApiKey } from "@/lib/auth/api-key";
import { log } from "@/lib/logger";

/**
 * Admin CRUD for programmatic API keys.
 *
 *   GET    /api/admin/api-keys           → list all (with code label)
 *   POST   /api/admin/api-keys           → mint a new key
 *   DELETE /api/admin/api-keys?id=X      → revoke
 *
 * Plaintext key is returned exactly ONCE on POST. Admin must copy it
 * immediately; the database only stores SHA-256(plaintext).
 */

const createSchema = z.object({
  label: z.string().min(1).max(120),
  codeId: z.string().uuid(),
  /** Optional per-key rate limit (req/min). Null = inherit endpoint default. */
  rateLimitPerMin: z.number().int().min(1).max(600).optional(),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      codeId: apiKeys.codeId,
      customerLabel: activationCodes.customerLabel,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .leftJoin(activationCodes, eq(activationCodes.id, apiKeys.codeId))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ ok: true, keys: rows });
}

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await parseJsonBody(request);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: "Validation failed.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  // Confirm the linked activation code exists. FK already protects
  // against orphan rows but returning 404 here lets the admin UI show
  // a clear error instead of a Postgres FK violation surfaced as 500.
  const [code] = await db
    .select({ id: activationCodes.id })
    .from(activationCodes)
    .where(eq(activationCodes.id, parsed.data.codeId))
    .limit(1);
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Activation code không tồn tại." },
      { status: 404 },
    );
  }

  const { plaintext, hash } = mintApiKey();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;

  const [row] = await db
    .insert(apiKeys)
    .values({
      keyHash: hash,
      label: parsed.data.label,
      codeId: parsed.data.codeId,
      rateLimitPerMin: parsed.data.rateLimitPerMin ?? null,
      expiresAt,
    })
    .returning({
      id: apiKeys.id,
      label: apiKeys.label,
      codeId: apiKeys.codeId,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
    });

  log.info("API_KEY_CREATED", {
    id: row?.id,
    label: parsed.data.label,
    codeId: parsed.data.codeId,
  });

  return NextResponse.json({
    ok: true,
    created: row,
    // Plaintext shown ONCE — admin must copy now.
    plaintext,
    note: "Lưu lại key ngay — không thể xem lại sau khi đóng dialog.",
  });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "id required" },
      { status: 400 },
    );
  }

  const [deleted] = await db
    .delete(apiKeys)
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id, label: apiKeys.label });
  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND" },
      { status: 404 },
    );
  }

  log.info("API_KEY_REVOKED", { id: deleted.id, label: deleted.label });
  return NextResponse.json({ ok: true, deleted });
}
