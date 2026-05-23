import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, apiKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { mintApiKey } from "@/lib/auth/api-key";
import { encrypt } from "@/lib/crypto/aes-gcm";
import { errFields, log } from "@/lib/logger";

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

  // Two-step fetch keeps SQL simple + cheap:
  //   1. Pull keys + linked code metadata (balance) — single LEFT JOIN
  //   2. Aggregate usage_logs in the last 30 days per key_id
  // Merge in JS. With ~50 keys max this stays under 100ms.
  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      codeId: apiKeys.codeId,
      customerLabel: activationCodes.customerLabel,
      codeMode: activationCodes.mode,
      codeQuotaEur: activationCodes.quotaEur,
      codeUsedEur: activationCodes.usedEur,
      codeIsActive: activationCodes.isActive,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
      // Drives the "Show key" button gate in the admin UI — true when
      // the key was minted after migration 0018 and we can decrypt
      // plaintext on demand.
      hasPlaintext: sql<boolean>`${apiKeys.keyEncrypted} IS NOT NULL`,
    })
    .from(apiKeys)
    .leftJoin(activationCodes, eq(activationCodes.id, apiKeys.codeId))
    .orderBy(desc(apiKeys.createdAt));

  // Aggregate usage_logs for last 30 days, GROUP BY key_id.
  // Filters by `key_id IS NOT NULL` so we skip ORM-impacted joins.
  const stats = await db.execute<{
    key_id: string;
    req_count: string;
    success_count: string;
    refunded_count: string;
    failed_count: string;
    pending_count: string;
    spend_eur: string;
  }>(sql`
    SELECT
      key_id,
      COUNT(*)::text AS req_count,
      COUNT(*) FILTER (WHERE status = 'succeeded')::text AS success_count,
      COUNT(*) FILTER (WHERE status = 'refunded')::text AS refunded_count,
      COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
      COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count,
      COALESCE(SUM(CASE WHEN status = 'succeeded' THEN cost_eur ELSE 0 END), 0)::text AS spend_eur
    FROM usage_logs
    WHERE key_id IS NOT NULL
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY key_id
  `);

  const statsRows = (stats as unknown as { rows: Array<{ key_id: string; req_count: string; success_count: string; refunded_count: string; failed_count: string; pending_count: string; spend_eur: string }> }).rows;
  const statsByKey = new Map<string, (typeof statsRows)[number]>();
  for (const s of statsRows) statsByKey.set(s.key_id, s);

  // Merge stats + compute derived fields the UI cares about.
  const enriched = rows.map((r) => {
    const s = statsByKey.get(r.id);
    const quota = r.codeQuotaEur === null ? null : Number(r.codeQuotaEur);
    const used = Number(r.codeUsedEur ?? 0);
    const remaining =
      r.codeMode === "unlimited" || quota === null ? null : quota - used;
    return {
      id: r.id,
      label: r.label,
      codeId: r.codeId,
      customerLabel: r.customerLabel,
      rateLimitPerMin: r.rateLimitPerMin,
      isActive: r.isActive,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      hasPlaintext: r.hasPlaintext,
      // Linked activation code balance snapshot — saves a roundtrip
      // when admin wants to know "how much credit does this key have?".
      account: {
        mode: r.codeMode,
        isActive: r.codeIsActive,
        quotaEur: quota,
        usedEur: used,
        remainingEur: remaining,
      },
      // Last 30 days via this specific key.
      usage30d: {
        reqCount: Number(s?.req_count ?? "0"),
        successCount: Number(s?.success_count ?? "0"),
        refundedCount: Number(s?.refunded_count ?? "0"),
        failedCount: Number(s?.failed_count ?? "0"),
        pendingCount: Number(s?.pending_count ?? "0"),
        spendEur: Number(s?.spend_eur ?? "0"),
      },
    };
  });

  return NextResponse.json({ ok: true, keys: enriched });
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

  // AES-GCM encrypt plaintext for admin-side reveal (migration 0018).
  // Decryption requires KEY_ENCRYPTION_SECRET — leaked DB alone yields
  // nothing.
  let keyEncrypted: string;
  try {
    keyEncrypted = await encrypt(plaintext);
  } catch (err) {
    log.error("API_KEY_ENCRYPT_FAILED", {
      label: parsed.data.label,
      ...errFields(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "ENCRYPT_FAILED",
        message: "Không thể lưu key — kiểm tra KEY_ENCRYPTION_SECRET.",
      },
      { status: 500 },
    );
  }

  const [row] = await db
    .insert(apiKeys)
    .values({
      keyHash: hash,
      keyEncrypted,
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
