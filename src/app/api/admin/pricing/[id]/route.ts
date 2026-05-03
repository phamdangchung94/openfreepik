import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pricingRules } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

const patchSchema = z.object({
  costEur: z.number().min(0),
});

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

  const [updated] = await db
    .update(pricingRules)
    .set({
      costEur: parsed.data.costEur.toFixed(2),
      updatedAt: sql`now()`,
    })
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
