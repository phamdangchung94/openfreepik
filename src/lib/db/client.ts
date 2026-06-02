/**
 * Drizzle DB client — Supabase Postgres via postgres-js driver
 * (migrated from Neon @neondatabase/serverless on 2026-05-31).
 *
 * Why the swap:
 *   - Neon Free quota suspended mid-month on 2026-05-31 → all routes
 *     started returning 5xx. Project chose Supabase Free as the
 *     replacement: same Postgres, no compute-hour metering.
 *   - As a side benefit, postgres-js supports REAL ACID transactions
 *     (db.transaction(callback)) — neon-http's HTTP wire protocol
 *     doesn't. We had been working around this in several places
 *     (bulk voucher mint, code redeem); future code can use proper
 *     transactions instead.
 *
 * Connection contract (Vercel serverless):
 *   - DATABASE_URL must point at Supabase's **transaction pooler**
 *     (port 6543, host like `aws-0-<region>.pooler.supabase.com`).
 *     The pooler multiplexes many serverless invocations onto a small
 *     pool of real Postgres connections. The direct port 5432 endpoint
 *     would exhaust Supabase's 60-connection cap within ~10 cold starts.
 *   - `prepare: false` is REQUIRED for the transaction pooler — pgBouncer
 *     in transaction mode doesn't support prepared statements (server
 *     can be reused mid-statement between clients).
 *   - `max: 1` because each Vercel function invocation reuses one
 *     connection for its lifetime; the pooler handles multiplexing,
 *     not us.
 *   - `idle_timeout: 20` so connections don't linger after a function
 *     completes — keeps the pooler's busy connection count low.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
