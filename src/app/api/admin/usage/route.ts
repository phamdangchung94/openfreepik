import { NextResponse } from "next/server";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/usage
 *
 * Optional query params:
 *   ?codeId=<uuid>     filter to one activation code
 *   ?status=<status>   filter to one status (succeeded/failed/refunded/pending)
 *   ?limit=<n>         default 100, max 500
 */
export async function GET(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(request.url);
  const codeId = url.searchParams.get("codeId");
  const status = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1),
    500,
  );

  const conditions: SQL[] = [];
  if (codeId) conditions.push(eq(usageLogs.codeId, codeId));
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
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      freepikTaskId: usageLogs.freepikTaskId,
      status: usageLogs.status,
    })
    .from(usageLogs)
    .leftJoin(activationCodes, eq(usageLogs.codeId, activationCodes.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit);

  return NextResponse.json({ ok: true, logs: rows });
}
