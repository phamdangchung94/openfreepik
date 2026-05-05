import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { probeKeyQuota } from "@/lib/freepik/probe-quota";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/keys/[id]/refresh-quota
 *
 * Probes Magnific with this key's plaintext via a lightweight GET (no
 * task created, no credit spent) and returns the captured response
 * headers. Used by the dashboard "Cập nhật" button so admin can see
 * Magnific's reported quota / rate-limit state without leaving the page.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [key] = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      keyEncrypted: freepikKeys.keyEncrypted,
    })
    .from(freepikKeys)
    .where(eq(freepikKeys.id, id))
    .limit(1);

  if (!key) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Key not found." },
      { status: 404 },
    );
  }

  const probe = await probeKeyQuota(key.keyEncrypted);
  log.info("KEY_QUOTA_PROBE", {
    id: key.id,
    label: key.label,
    status: probe.status,
    headerCount: Object.keys(probe.headers).length,
    elapsedMs: probe.elapsedMs,
  });

  return NextResponse.json({
    ok: true,
    id: key.id,
    label: key.label,
    probe,
  });
}
