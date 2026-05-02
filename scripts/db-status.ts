/**
 * Quick health check — list tables and row counts in the configured DB.
 *
 * Usage: pnpm db:status
 */

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

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
    const result = await sql.query(`SELECT count(*)::int AS n FROM ${t}`);
    rows.push({ table: t, rows: (result[0] as { n: number }).n });
  }
  console.table(rows);
}

main().catch((err) => {
  console.error("Status check failed:", err);
  process.exit(1);
});
