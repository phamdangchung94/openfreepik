import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { activationCodes, type NewActivationCode } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/codes/bulk — mint N codes with auto-numbered labels.
 *
 * Pattern: each code gets `customer_label = "{prefix}-{n}"` where `n` is
 * zero-padded to the width of `start + count - 1`. Codes themselves
 * (the activation token) are still random per existing `generateCode()`
 * so they can't be guessed from the label.
 *
 * Same quota, mode, and (optional) expiry applied to every code in the
 * batch — that's the common admin flow (issue 50 codes for a school /
 * agency, all with the same 10 EUR cap).
 *
 * Atomic transaction: either all N codes insert or none do. Caps at 200
 * codes per call to keep one bad request from blowing up the table.
 */

const MAX_BULK = 200;

const bulkSchema = z.object({
  prefix: z.string().min(1).max(20).regex(/^[\w.-]+$/, {
    message: "Prefix chỉ chứa chữ, số, dấu '-', '_', '.'",
  }),
  startNumber: z.number().int().min(0).max(99999).default(1),
  count: z.number().int().min(1).max(MAX_BULK),
  mode: z.enum(["unlimited", "quota", "topup"]),
  quotaEur: z.number().min(0).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await parseJsonBody(request);
  const parsed = bulkSchema.safeParse(body);
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
        message: `quotaEur required when mode=${parsed.data.mode}`,
      },
      { status: 400 },
    );
  }

  const { prefix, startNumber, count, mode, quotaEur, expiresInDays } =
    parsed.data;

  // Auto-pad to width of the largest number in the batch so labels sort
  // lexicographically (ABC-001..ABC-050 instead of ABC-1..ABC-50 which
  // would put ABC-10 before ABC-2).
  const lastNumber = startNumber + count - 1;
  const padWidth = String(lastNumber).length;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : null;
  const quotaStr = quotaEur?.toFixed(2) ?? null;

  const rows: NewActivationCode[] = [];
  for (let i = 0; i < count; i++) {
    const n = startNumber + i;
    rows.push({
      code: generateCode(),
      customerLabel: `${prefix}-${String(n).padStart(padWidth, "0")}`,
      mode,
      quotaEur: quotaStr,
      expiresAt,
    });
  }

  const inserted = await db.transaction(async (tx) => {
    return tx.insert(activationCodes).values(rows).returning({
      id: activationCodes.id,
      code: activationCodes.code,
      customerLabel: activationCodes.customerLabel,
    });
  });

  log.info("CODES_BULK_CREATED", {
    prefix,
    startNumber,
    count: inserted.length,
    mode,
    quotaEur: quotaEur ?? null,
  });

  return NextResponse.json({ ok: true, created: inserted });
}

/** Same generator as the single-create POST. Kept in sync by intent. */
function generateCode(): string {
  const random = randomBytes(20).toString("base64url").toUpperCase();
  const chunks = random.match(/.{1,5}/g) ?? [];
  return `FK-${chunks.join("-")}`;
}
