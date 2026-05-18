import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/codes/[id]/impersonate
 *
 * Returns the customer's activation code so admin can paste it into
 * the customer-facing `/` to reproduce a bug or verify a flow. Every
 * call is logged as `ADMIN_IMPERSONATE_CODE` with the codeId and
 * customer label — that's the audit trail.
 *
 * Why we don't mint a separate short-lived token:
 *   - Activation codes ARE the bearer credential by design (no JWT).
 *   - A separate token model would require schema + auth changes for
 *     a feature used a handful of times per week.
 *   - Single-admin trust model + log audit is sufficient.
 *
 * Admin frontend should:
 *   1. POST here
 *   2. Copy the returned code to clipboard
 *   3. Open `/` in a new tab and paste into the activation input
 *
 * Refused if the code is inactive — admin should reactivate first to
 * make the impersonation behave like a real customer flow.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [row] = await db
    .select({
      id: activationCodes.id,
      code: activationCodes.code,
      customerLabel: activationCodes.customerLabel,
      isActive: activationCodes.isActive,
    })
    .from(activationCodes)
    .where(eq(activationCodes.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Code not found." },
      { status: 404 },
    );
  }
  if (!row.isActive) {
    return NextResponse.json(
      {
        ok: false,
        error: "CODE_INACTIVE",
        message: "Code đang inactive — reactivate trước khi impersonate.",
      },
      { status: 409 },
    );
  }

  // Audit: who took the bearer, when. Admin is single-actor here, so
  // we don't track which admin (there's only one). If multi-admin
  // ships later, plumb admin session id into the log fields.
  log.info("ADMIN_IMPERSONATE_CODE", {
    codeId: row.id,
    customerLabel: row.customerLabel,
  });

  return NextResponse.json({
    ok: true,
    code: row.code,
    customerLabel: row.customerLabel,
  });
}
