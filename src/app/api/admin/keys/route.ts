import { NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { addKey } from "@/lib/freepik/key-pool";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

/** GET /api/admin/keys — list keys (no plaintext exposed). */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rows = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      assignedEur: freepikKeys.assignedEur,
      usedEur: freepikKeys.usedEur,
      isActive: freepikKeys.isActive,
      notes: freepikKeys.notes,
      createdAt: freepikKeys.createdAt,
      lastUsedAt: freepikKeys.lastUsedAt,
    })
    .from(freepikKeys)
    .orderBy(desc(freepikKeys.createdAt))
    // Audit P1-6: ceiling at 100. We don't expect 100+ Freepik keys
    // ever — this is just a defensive cap so a future bug that creates
    // duplicates doesn't pull a million rows.
    .limit(100);

  return NextResponse.json({ ok: true, keys: rows });
}

const createSchema = z.object({
  label: z.string().min(1).max(120),
  plaintextKey: z.string().min(8).max(256),
  assignedEur: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

/** POST /api/admin/keys — encrypt + store a new Freepik key. */
export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await parseJsonBody(request);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id } = await addKey(parsed.data);
  return NextResponse.json({ ok: true, id });
}
