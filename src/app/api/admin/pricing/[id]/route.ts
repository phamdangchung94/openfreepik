import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pricingRules } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

/**
 * 2-layer pricing PATCH (migration 0021). Admin can edit either column
 * independently — `costEur` is what the customer pays (deducted from
 * activation code balance), `upstreamCostEur` is what Magnific charges
 * us per request. Both optional so the existing single-column UI
 * (EUR input only) keeps working until the admin page upgrade ships.
 * At least one must be supplied; refine() guards against an empty body.
 */
const patchSchema = z
  .object({
    costEur: z.number().min(0).optional(),
    upstreamCostEur: z.number().min(0).optional(),
  })
  .refine(
    (v) => v.costEur !== undefined || v.upstreamCostEur !== undefined,
    { message: "At least one of costEur or upstreamCostEur is required." },
  );

/** PATCH /api/admin/pricing/[id] — update a single pricing rule's cost. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Build the update patch — include only fields admin actually sent.
  // 4-decimal precision for upstream matches the numeric(10,4) column;
  // customer-facing cost stays 2-decimal (kept stable for legacy
  // consumers like /v1/models that parseFloat to 2dp anyway).
  const updateSet: Record<string, unknown> = { updatedAt: sql`now()` };
  if (parsed.data.costEur !== undefined) {
    updateSet.costEur = parsed.data.costEur.toFixed(2);
  }
  if (parsed.data.upstreamCostEur !== undefined) {
    updateSet.upstreamCostEur = parsed.data.upstreamCostEur.toFixed(4);
  }

  const [updated] = await db
    .update(pricingRules)
    .set(updateSet)
    .where(eq(pricingRules.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Pricing rule not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, updated });
}
