/**
 * No-auth diagnostic — verifies the runtime, the DB connection, and the
 * exact query paths that /api/usage and /api/download use. Returns
 * type/shape info instead of any PII so this stays safe public.
 *
 * If a probe throws, the JSON includes `<probe>_error.{name,msg}` so
 * we can identify the exact failure without needing function log access.
 */

import { db } from "@/lib/db/client";
import { activationCodes, usageLogs } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export async function GET() {
  const out: Record<string, unknown> = {
    region: process.env.VERCEL_REGION ?? "unknown",
    runtime: process.versions?.node ? `node ${process.versions.node}` : "edge",
  };

  // 1. Schema/types from a single activationCodes row
  try {
    const start = Date.now();
    const rows = await db
      .select({
        id: activationCodes.id,
        createdAt: activationCodes.createdAt,
        expiresAt: activationCodes.expiresAt,
      })
      .from(activationCodes)
      .limit(1);
    out.db_ok = true;
    out.db_ms = Date.now() - start;
    if (rows.length > 0) {
      const row = rows[0]!;
      out.sample = {
        createdAtIsDate: row.createdAt instanceof Date,
        expiresAtIsDate: row.expiresAt instanceof Date,
        expiresAtIsNull: row.expiresAt === null,
      };
    }
  } catch (err) {
    out.db_ok = false;
    const e = err as Error;
    out.db_error = { name: e?.name, msg: String(e?.message ?? err).slice(0, 400) };
  }

  // 2. Reproduce /api/usage's recent SELECT — surfaces if the column
  //    list / map() chain has a runtime issue.
  try {
    const [anyCode] = await db
      .select({ id: activationCodes.id })
      .from(activationCodes)
      .where(eq(activationCodes.isActive, true))
      .limit(1);
    if (!anyCode) {
      out.usage_query = "no_active_code";
    } else {
      const recent = await db
        .select({
          id: usageLogs.id,
          createdAt: usageLogs.createdAt,
          endpoint: usageLogs.endpoint,
          tier: usageLogs.tier,
          durationSeconds: usageLogs.durationSeconds,
          withAudio: usageLogs.withAudio,
          costEur: usageLogs.costEur,
          freepikTaskId: usageLogs.freepikTaskId,
          videoUrl: usageLogs.videoUrl,
          videoUrlExpiresAt: usageLogs.videoUrlExpiresAt,
          status: usageLogs.status,
        })
        .from(usageLogs)
        .where(eq(usageLogs.codeId, anyCode.id))
        .orderBy(desc(usageLogs.createdAt))
        .limit(3);
      // Try the same map() the usage route does
      recent.map((r) => ({
        ...r,
        costEur: Number(r.costEur),
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt),
        videoUrlExpiresAt: r.videoUrlExpiresAt
          ? r.videoUrlExpiresAt instanceof Date
            ? r.videoUrlExpiresAt.toISOString()
            : String(r.videoUrlExpiresAt)
          : null,
      }));
      out.usage_query_ok = true;
      out.usage_recent_count = recent.length;
      out.usage_first_types = recent[0]
        ? {
            createdAtIsDate: recent[0].createdAt instanceof Date,
            videoUrlExpiresAtIsDate:
              recent[0].videoUrlExpiresAt instanceof Date,
            videoUrlExpiresAtIsNull: recent[0].videoUrlExpiresAt === null,
            costEurType: typeof recent[0].costEur,
          }
        : null;
    }
  } catch (err) {
    out.usage_query_ok = false;
    const e = err as Error;
    out.usage_error = {
      name: e?.name,
      msg: String(e?.message ?? err).slice(0, 400),
    };
  }

  // 3. Reproduce /api/download's lookup — pick a recent succeeded row.
  try {
    const [anyLog] = await db
      .select({
        videoUrl: usageLogs.videoUrl,
        expiresAt: usageLogs.videoUrlExpiresAt,
        codeId: usageLogs.codeId,
        freepikTaskId: usageLogs.freepikTaskId,
      })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.status, "succeeded"),
          gte(usageLogs.createdAt, sql`now() - interval '24 hours'`),
        ),
      )
      .limit(1);
    out.download_lookup_ok = true;
    out.download_first = anyLog
      ? {
          hasUrl: !!anyLog.videoUrl,
          urlPrefix: anyLog.videoUrl?.slice(0, 40) ?? null,
          hasExpiresAt: !!anyLog.expiresAt,
          expiresAtIsDate: anyLog.expiresAt instanceof Date,
          freepikTaskIdLen: anyLog.freepikTaskId?.length ?? 0,
        }
      : "no_succeeded_logs_in_24h";
  } catch (err) {
    out.download_lookup_ok = false;
    const e = err as Error;
    out.download_error = {
      name: e?.name,
      msg: String(e?.message ?? err).slice(0, 400),
    };
  }

  return Response.json(out);
}
