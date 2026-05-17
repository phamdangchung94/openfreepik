import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { announcements } from "@/lib/db/schema";

/**
 * Public endpoint — customer's page hits this on mount to fetch the
 * current set of active broadcast announcements. No auth required;
 * data here is intentionally public-readable.
 *
 * Filter: `active = true` AND (`expires_at IS NULL` OR `expires_at >
 * now()`). Returns up to 10 most recent.
 *
 * No-store cache header — customer should see admin edits within seconds
 * without hitting a stale CDN copy.
 */
export async function GET() {
  const now = new Date();
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      ctaLabel: announcements.ctaLabel,
      ctaUrl: announcements.ctaUrl,
      severity: announcements.severity,
      createdAt: announcements.createdAt,
      expiresAt: announcements.expiresAt,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.active, true),
        or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
      ),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(10);

  return NextResponse.json(
    { ok: true, announcements: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
