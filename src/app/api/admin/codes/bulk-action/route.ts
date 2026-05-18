import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/codes/bulk-action — batched ops over multiple codes.
 *
 * Body: { action: "revoke" | "reactivate" | "topup", ids: string[], amount?: number }
 *
 * - `revoke`     → flip is_active=false for every id
 * - `reactivate` → flip is_active=true for every id
 * - `topup`      → atomic SQL increment of quota_eur by `amount`. Only
 *                  meaningful for `topup`-mode codes; quota/unlimited
 *                  codes silently no-op since their quota model differs.
 *                  Race-safe: uses `quota_eur = quota_eur + amount`.
 *
 * All ops are best-effort partial — if 50/100 codes don't exist, the
 * 50 that do still update. Response reports both counts.
 *
 * Cap: 200 ids per request (matches bulk-create cap; keeps single
 * request budget bounded).
 */

const MAX_BULK = 200;

const bodySchema = z.object({
  action: z.enum(["revoke", "reactivate", "topup"]),
  ids: z.array(z.string().uuid()).min(1).max(MAX_BULK),
  amount: z.number().positive().optional(),
});

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await parseJsonBody(request);
  const parsed = bodySchema.safeParse(body);
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

  const { action, ids, amount } = parsed.data;

  if (action === "topup") {
    if (amount === undefined) {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "amount required for topup",
        },
        { status: 400 },
      );
    }
    const cents = amount.toFixed(2);
    const updated = await db
      .update(activationCodes)
      .set({
        // Only top up codes that are actually in topup mode — quota-mode
        // codes have a fixed quota set at issue; modifying them via
        // bulk-topup would be confusing. Filter at the WHERE level so
        // the count reported is accurate.
        quotaEur: sql`COALESCE(${activationCodes.quotaEur}, '0') + ${cents}`,
      })
      .where(
        sql`${activationCodes.id} IN ${inArray(activationCodes.id, ids)} AND ${activationCodes.mode} = 'topup'`,
      )
      .returning({ id: activationCodes.id });
    log.info("CODES_BULK_TOPPED_UP", {
      requested: ids.length,
      updated: updated.length,
      amountEur: amount,
    });
    return NextResponse.json({
      ok: true,
      requested: ids.length,
      updated: updated.length,
      skipped: ids.length - updated.length,
    });
  }

  // revoke / reactivate
  const updated = await db
    .update(activationCodes)
    .set({ isActive: action === "reactivate" })
    .where(inArray(activationCodes.id, ids))
    .returning({ id: activationCodes.id });

  log.info(
    action === "revoke" ? "CODES_BULK_REVOKED" : "CODES_BULK_REACTIVATED",
    { requested: ids.length, updated: updated.length },
  );
  return NextResponse.json({
    ok: true,
    requested: ids.length,
    updated: updated.length,
  });
}
