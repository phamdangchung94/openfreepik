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
  ssl: "require",
  connect_timeout: 5,
});

async function main() {
  const rows: Array<{ table: string; rows: number }> = [];
  const tables = await sql<{ table: string }[]>`
    SELECT tablename AS table
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  for (const { table } of tables) {
    // postgres-js parameterizes values, not identifiers. Table names come
    // from Postgres' public schema catalog and are quoted before use.
    const result = await sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.${quoteIdentifier(table)}`,
    );
    rows.push({ table, rows: result[0]?.n ?? 0 });
  }
  console.table(rows);
  await sql.end();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

main().catch(async (err) => {
  console.error("Status check failed:", err);
  await sql.end();
  process.exit(1);
});
