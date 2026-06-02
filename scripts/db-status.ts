/**
 * Quick health check — list tables and row counts in the configured DB.
 *
 * Usage: pnpm db:status
 */

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 10,
});

const TABLES = [
  "freepik_keys",
  "activation_codes",
  "usage_logs",
  "pricing_rules",
  "admin_sessions",
  "rate_limit_buckets",
  "failed_logins",
  "__drizzle_migrations",
] as const;

async function main() {
  const rows: Array<{ table: string; rows: number }> = [];
  for (const t of TABLES) {
    // postgres-js: tagged templates parameterize, sql.unsafe() for
    // dynamic identifiers (table name interpolation). Table names come
    // from a hard-coded allowlist above so no injection risk.
    const result = await sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${t}`,
    );
    rows.push({ table: t, rows: result[0]?.n ?? 0 });
  }
  console.table(rows);
  await sql.end();
}

main().catch(async (err) => {
  console.error("Status check failed:", err);
  await sql.end();
  process.exit(1);
});
