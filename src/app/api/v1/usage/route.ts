import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { apiError, apiSuccess } from "@/lib/api-v1/response";

/**
 * GET /api/v1/usage
 *
 * Self-serve spend history scoped to the authenticated API key's
 * activation code. Customer can audit cost without going through
 * admin support.
 *
 * Query params:
 *   - limit:   1..200 (default 50)
 *   - offset:  int (default 0)
 *   - since:   ISO timestamp, default "30 days ago"
 *
 * Response:
 *   {
 *     ok: true,
 *     usage: [{ task_id, endpoint, status, cost_eur, prompt,
 *               video_url, video_url_expires_at, created_at }, ...],
 *     summary: { total_count, total_cost_eur, by_status: {...} },
 *     balance: { used_eur, quota_eur, remaining_eur }
 *   }
 *
 * Notes:
 *   - Returns ALL usage rows for the activation code (not just the
 *     API key's own) — billing model is "API key shares balance with
 *     activation code", so the customer sees total spend.
 *   - Endpoint label is the internal slug (e.g. "kling-v3",
 *     "kling-motion-v3-pro") — same value /v1/models uses for the
 *     `id` field.
 *   - `video_url` may be null when the URL has expired (24h after
 *     generation) — customer must re-generate to get a fresh URL.
 */
export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? "50")),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));

  const sinceParam = url.searchParams.get("since");
  let sinceDate: Date;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (Number.isNaN(parsed.getTime())) {
      return apiError({
        status: 400,
        error: "BAD_REQUEST",
        message:
          "Invalid `since` parameter — use ISO 8601 (e.g. 2026-05-01T00:00:00Z).",
        requestId: auth.requestId,
      });
    }
    sinceDate = parsed;
  } else {
    sinceDate = new Date(Date.now() - 30 * 86_400_000); // 30 days ago
  }

  const codeId = auth.metadata.codeId;

  // Fetch one page worth of rows. We return the full row but drop
  // internal-only fields (key_id, magnific_video_url) for cleanliness.
  const rows = await db
    .select({
      id: usageLogs.id,
      taskId: usageLogs.freepikTaskId,
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      status: usageLogs.status,
      videoUrl: usageLogs.videoUrl,
      videoUrlExpiresAt: usageLogs.videoUrlExpiresAt,
      errorMessage: usageLogs.errorMessage,
      prompt: usageLogs.prompt,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.codeId, codeId),
        gte(usageLogs.createdAt, sinceDate),
      ),
    )
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Quick aggregate over the same time window (NOT just the page) —
  // customer wants to know "spend in last 30 days", not "spend in
  // these 50 rows".
  const allRows = await db
    .select({
      status: usageLogs.status,
      costEur: usageLogs.costEur,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.codeId, codeId),
        gte(usageLogs.createdAt, sinceDate),
      ),
    );

  let totalCostEur = 0;
  const byStatus: Record<string, number> = {};
  for (const r of allRows) {
    const c = Number(r.costEur);
    // Refunded rows don't count toward spend (charge was reversed).
    if (r.status !== "refunded") totalCostEur += c;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  return apiSuccess({
    requestId: auth.requestId,
    data: {
      ok: true,
      usage: rows.map((r) => ({
        id: r.id,
        task_id: r.taskId,
        endpoint: r.endpoint,
        tier: r.tier,
        duration_seconds: r.durationSeconds,
        with_audio: r.withAudio,
        cost_eur: Number(r.costEur),
        status: r.status,
        video_url: r.videoUrl,
        video_url_expires_at: r.videoUrlExpiresAt,
        error_message: r.errorMessage,
        prompt: r.prompt,
        created_at: r.createdAt,
      })),
      summary: {
        total_count: allRows.length,
        // Round to 4 dp to dodge floating-point display noise without
        // losing meaningful precision (sub-cent billing).
        total_cost_eur: Math.round(totalCostEur * 10000) / 10000,
        by_status: byStatus,
        since: sinceDate.toISOString(),
      },
      balance: {
        mode: auth.metadata.mode,
        used_eur: auth.metadata.usedEur,
        quota_eur: auth.metadata.quotaEur,
        remaining_eur: auth.metadata.remainingEur,
      },
      pagination: {
        limit,
        offset,
        returned: rows.length,
        has_more: rows.length === limit,
      },
    },
  });
}
