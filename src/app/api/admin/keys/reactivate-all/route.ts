import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/keys/reactivate-all
 *
 * Emergency recovery: flips every freepik_keys row to is_active=true.
 * Lets admin recover from any past whack-a-mole pool drain in one click,
 * without needing psql access. Pairs with the conservative
 * isKeyExhaustedError policy (only QUOTA_EXHAUSTED auto-disables).
 *
 * Re-running on already-active keys is a no-op — UPDATE WHERE is_active
 * = false ensures we only touch the dead rows.
 */
export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const reactivated = await db
    .update(freepikKeys)
    .set({ isActive: true })
    .where(eq(freepikKeys.isActive, false))
    .returning({ id: freepikKeys.id, label: freepikKeys.label });

  log.info("KEYS_REACTIVATE_ALL", {
    count: reactivated.length,
    labels: reactivated.map((k) => k.label),
  });

  return NextResponse.json({ ok: true, count: reactivated.length, reactivated });
}
