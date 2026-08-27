/**
 * Normalize raw `db.execute(sql`...`) results across Drizzle drivers.
 *
 * The previous Neon HTTP driver exposed `{ rows }`; postgres-js returns
 * the row list directly. Keep this at the DB boundary so call sites can
 * stay driver-agnostic.
 */
export function rawRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  return [];
}
