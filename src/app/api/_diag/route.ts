/**
 * No-auth diagnostic — checks that the function runtime and the DB
 * connection are healthy from whichever Vercel region is serving this
 * request. Returns the raw shape of a single row so we can verify
 * whether neon-http hands timestamps back as Date or string.
 *
 * Safe to leave public: doesn't return PII (no codes, keys, balances)
 * — only schema-level signals.
 */

import { db } from "@/lib/db/client";
import { activationCodes } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  const out: Record<string, unknown> = {
    region: process.env.VERCEL_REGION ?? "unknown",
    runtime: process.versions?.node ? `node ${process.versions.node}` : "edge",
  };

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
        idType: typeof row.id,
        createdAtType: typeof row.createdAt,
        createdAtIsDate: row.createdAt instanceof Date,
        expiresAtType: typeof row.expiresAt,
        expiresAtIsDate: row.expiresAt instanceof Date,
        // Show the literal serialised form so we know exactly what
        // neon-http hands back.
        createdAtSerialised: JSON.stringify(row.createdAt),
        expiresAtSerialised: JSON.stringify(row.expiresAt),
      };
    } else {
      out.sample = "no_rows";
    }
  } catch (err) {
    out.db_ok = false;
    const e = err as Error;
    out.db_error = { name: e?.name, msg: String(e?.message ?? err).slice(0, 400) };
  }

  return Response.json(out);
}
