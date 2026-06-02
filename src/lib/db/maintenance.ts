/**
 * Short-lived write freeze used during database cutovers.
 *
 * Keep the value strict so a typo cannot unexpectedly take production
 * offline. The flag is server-only and must never use a NEXT_PUBLIC_ prefix.
 */
export function isDbMigrationMaintenanceMode(
  value = process.env.DB_MIGRATION_MAINTENANCE_MODE,
): boolean {
  return value === "1";
}

export const DB_MIGRATION_RETRY_AFTER_SECONDS = 60;
