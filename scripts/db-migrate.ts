/**
 * Apply Drizzle-generated migration files to Postgres via postgres-js.
 *
 * Originally a workaround for `drizzle-kit push` hanging on Neon's pooled
 * connection. After the 2026-05-31 Neon→Supabase migration we still keep
 * this script because Supabase's pgBouncer pooler has the same issue
 * with drizzle-kit's interactive prompts.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/db-migrate.ts
 */

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// max:1 + prepare:false matches the runtime client config — pooler safe.
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  ssl: "require",
  connect_timeout: 5,
});
const MIGRATIONS_DIR = "drizzle/migrations";

async function main() {
  // Sanity check connection
  const ping = await sql<{ now: Date }[]>`SELECT now() AS now`;
  console.log(`Connected at ${ping[0]?.now?.toISOString() ?? "unknown"}`);

  // Track applied migrations in a small table
  await sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const exists = await sql`
      SELECT 1 FROM __drizzle_migrations WHERE filename = ${filename}
    `;
    if (exists.length > 0) {
      console.log(`SKIP ${filename} (already applied)`);
      continue;
    }

    const fullPath = join(MIGRATIONS_DIR, filename);
    const contents = readFileSync(fullPath, "utf8");

    // Drizzle uses `--> statement-breakpoint` to separate statements
    const statements = contents
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`APPLY ${filename} (${statements.length} statements)`);
    for (const stmt of statements) {
      // postgres-js: tagged templates parameterize, .unsafe() runs raw SQL.
      // Migration files contain DDL with no params, so unsafe() is correct.
      await sql.unsafe(stmt);
    }

    await sql`INSERT INTO __drizzle_migrations (filename) VALUES (${filename})`;
    console.log(`  → done`);
  }

  console.log("All migrations applied.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await sql.end();
  process.exit(1);
});
