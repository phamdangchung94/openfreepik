/**
 * Apply Drizzle-generated migration files to Neon via the HTTP driver.
 * Workaround for `drizzle-kit push` hanging on Neon's pooled connection.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/db-migrate.ts
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const MIGRATIONS_DIR = "drizzle/migrations";

async function main() {
  // Sanity check connection
  const ping = await sql`SELECT now() AS now`;
  console.log(`Connected to Neon at ${ping[0]?.now}`);

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
      await sql.query(stmt);
    }

    await sql`INSERT INTO __drizzle_migrations (filename) VALUES (${filename})`;
    console.log(`  → done`);
  }

  console.log("All migrations applied.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
