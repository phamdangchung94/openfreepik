import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activationCodes,
  usageLogs,
  type NewActivationCode,
} from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

/**
 * GET /api/admin/codes?limit=50&offset=0 — list codes with succeeded-usage rollup.
 *
 * Audit P1-5: paginated. The LEFT JOIN aggregating succeeded usage_logs
 * per code is O(codes × usage_rows) and was returning every row — fine
 * at 4 codes, problematic past ~200 customers. Default limit 50, capped
 * at 200.
 */
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;

export async function GET(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? LIST_DEFAULT_LIMIT);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), LIST_MAX_LIMIT)
      : LIST_DEFAULT_LIMIT;
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  // LEFT JOIN + GROUP BY beats a correlated subquery here — drizzle's sql
  // template doesn't always alias correlated references the way Postgres
  // expects inside scalar subselects.
  const rows = await db
    .select({
      id: activationCodes.id,
      code: activationCodes.code,
      label: activationCodes.customerLabel,
      mode: activationCodes.mode,
      quotaEur: activationCodes.quotaEur,
      usedEur: activationCodes.usedEur,
      isActive: activationCodes.isActive,
      createdAt: activationCodes.createdAt,
      expiresAt: activationCodes.expiresAt,
      videosGenerated: sql<number>`COALESCE(count(${usageLogs.id}) FILTER (WHERE ${usageLogs.status} = 'succeeded'), 0)::int`,
    })
    .from(activationCodes)
    .leftJoin(usageLogs, eq(usageLogs.codeId, activationCodes.id))
    .groupBy(activationCodes.id)
    .orderBy(desc(activationCodes.createdAt))
    .limit(limit)
    .offset(offset);

  // Cheap total — separate query so the dashboard can paginate UI.
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(activationCodes);

  return NextResponse.json({
    ok: true,
    codes: rows,
    pagination: { limit, offset, total },
  });
}

const createSchema = z.object({
  mode: z.enum(["unlimited", "quota", "topup"]),
  quotaEur: z.number().min(0).optional(),
  customerLabel: z.string().max(120).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

/** POST /api/admin/codes — mint a new activation code. */
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

  if (parsed.data.mode !== "unlimited" && parsed.data.quotaEur === undefined) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: `quotaEur is required when mode=${parsed.data.mode}`,
      },
      { status: 400 },
    );
  }

  const code = generateCode();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;

  const row: NewActivationCode = {
    code,
    mode: parsed.data.mode,
    quotaEur: parsed.data.quotaEur?.toFixed(2) ?? null,
    customerLabel: parsed.data.customerLabel ?? null,
    expiresAt,
  };

  const [inserted] = await db.insert(activationCodes).values(row).returning();
  if (!inserted) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: "Insert returned no rows" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, created: inserted });
}

/** Generate a 32-byte URL-safe code prefixed FK- and chunked for readability. */
function generateCode(): string {
  const random = randomBytes(20).toString("base64url").toUpperCase();
  const chunks = random.match(/.{1,5}/g) ?? [];
  return `FK-${chunks.join("-")}`;
}
