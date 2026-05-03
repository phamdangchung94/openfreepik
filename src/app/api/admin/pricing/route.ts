import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pricingRules } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/** GET /api/admin/pricing — list all pricing rules ordered by tier+duration. */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rows = await db
    .select()
    .from(pricingRules)
    .orderBy(
      asc(pricingRules.endpoint),
      asc(pricingRules.tier),
      asc(pricingRules.durationSeconds),
      asc(pricingRules.withAudio),
    );

  return NextResponse.json({ ok: true, rules: rows });
}
