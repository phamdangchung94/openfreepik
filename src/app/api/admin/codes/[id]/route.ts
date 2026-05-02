import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  customerLabel: z.string().max(120).nullable().optional(),
  /** Replace the quota cap (quota/topup modes only). */
  quotaEur: z.number().min(0).nullable().optional(),
  /** Increment current quota — convenience for top-up mode. Race-safe SQL. */
  addEur: z.number().positive().optional(),
});

/** PATCH /api/admin/codes/[id] — revoke, edit label, or top up balance. */
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

  const updates: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.customerLabel !== undefined)
    updates.customerLabel = parsed.data.customerLabel;

  if (parsed.data.addEur !== undefined) {
    // Atomic increment — wins over a read-modify-write if two top-ups race.
    const amount = parsed.data.addEur.toFixed(2);
    updates.quotaEur = sql`COALESCE(${activationCodes.quotaEur}, 0) + ${amount}`;
  } else if (parsed.data.quotaEur !== undefined) {
    updates.quotaEur = parsed.data.quotaEur?.toFixed(2) ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "No fields to update." },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(activationCodes)
    .set(updates)
    .where(eq(activationCodes.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Code not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, updated });
}
