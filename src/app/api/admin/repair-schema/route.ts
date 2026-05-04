/**
 * One-shot repair endpoint — applies any missing schema migrations
 * without needing local DATABASE_URL access. Idempotent (uses
 * `ADD COLUMN IF NOT EXISTS`) so safe to call multiple times.
 *
 * Auth: shared secret in `Authorization: Bearer <CRON_SECRET>` header.
 * The cron secret is already in env and rotated separately, so reusing
 * it for emergency repair is acceptable.
 *
 * Why this exists: the worktree where `pnpm db:migrate` was run last
 * pointed at a different DATABASE_URL than what Vercel production
 * uses. Result: production DB never got the `video_url_expires_at`
 * column from migration 0002, breaking /api/usage and /api/download
 * with "Failed query" errors. Rather than coordinating a manual
 * migration run, this lets the running function repair its own DB.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return Response.json({ error: "AUTH" }, { status: 401 });
  }

  const ops: Array<{ sql: string; ok: boolean; error?: string }> = [];

  // Migration 0002 — usage_logs.video_url_expires_at
  await runIdempotent(
    `ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "video_url_expires_at" timestamp with time zone`,
    ops,
  );

  // Verify column now exists.
  const cols = await db.execute<{ column_name: string }>(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='usage_logs'
        ORDER BY ordinal_position`,
  );
  const colArr =
    (cols as unknown as { rows?: Array<{ column_name: string }> }).rows
    ?? (cols as unknown as Array<{ column_name: string }>);

  return Response.json({
    ok: true,
    operations: ops,
    usage_logs_columns: colArr.map((c) => c.column_name),
  });
}

async function runIdempotent(
  statement: string,
  log: Array<{ sql: string; ok: boolean; error?: string }>,
) {
  try {
    await db.execute(sql.raw(statement));
    log.push({ sql: statement, ok: true });
  } catch (err) {
    const e = err as Error;
    log.push({
      sql: statement,
      ok: false,
      error: String(e?.message ?? err).slice(0, 300),
    });
  }
}
