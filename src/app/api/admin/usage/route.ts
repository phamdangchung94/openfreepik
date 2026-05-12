import { NextResponse } from "next/server";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, freepikKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/usage
 *
 * Optional query params:
 *   ?codeId=<uuid>     filter to one activation code
 *   ?keyId=<uuid>      filter to one Freepik key
 *   ?status=<status>   filter to one status (succeeded/failed/refunded/pending)
 *   ?limit=<n>         default 100, max 2000
 *
 * Returns rows with both customer label (joined from activation_codes)
 * and key label (joined from freepik_keys), plus the Magnific original
 * URL and the R2 mirror URL so admin can audit per-row video provenance.
 */
export async function GET(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(request.url);
  const codeId = url.searchParams.get("codeId");
  const keyId = url.searchParams.get("keyId");
  const status = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1),
    // Bumped from 500 to 2000 — admin CSV export needs the full window
    // even on busy days (10K+ tasks/day not unrealistic at scale).
    2000,
  );

  const conditions: SQL[] = [];
  if (codeId) conditions.push(eq(usageLogs.codeId, codeId));
  if (keyId) conditions.push(eq(usageLogs.keyId, keyId));
  if (
    status === "succeeded" ||
    status === "failed" ||
    status === "refunded" ||
    status === "pending"
  ) {
    conditions.push(eq(usageLogs.status, status));
  }

  const rows = await db
    .select({
      id: usageLogs.id,
      createdAt: usageLogs.createdAt,
      codeId: usageLogs.codeId,
      codeLabel: activationCodes.customerLabel,
      keyId: usageLogs.keyId,
      keyLabel: freepikKeys.label,
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      freepikTaskId: usageLogs.freepikTaskId,
      videoUrl: usageLogs.videoUrl,
      magnificVideoUrl: usageLogs.magnificVideoUrl,
      status: usageLogs.status,
      errorMessage: usageLogs.errorMessage,
    })
    .from(usageLogs)
    .leftJoin(activationCodes, eq(usageLogs.codeId, activationCodes.id))
    .leftJoin(freepikKeys, eq(usageLogs.keyId, freepikKeys.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit);

  return NextResponse.json({ ok: true, logs: rows });
}
