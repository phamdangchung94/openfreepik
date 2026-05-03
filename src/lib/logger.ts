/**
 * Structured logger — emits single-line JSON to console so a Vercel Log
 * Drain (Logtail / Datadog / Better Stack) parses it natively without a
 * custom transformer.
 *
 * Why not Sentry/Pino directly: zero deps, works on Edge + Node, and the
 * line-JSON shape is what every aggregator expects out of the box.
 * Migrating to Sentry later is just swapping the body of these functions.
 *
 * Convention for events that admin should grep / alert on:
 *   - REFUND_FAILED      — manual reconciliation needed (audit #4 fix)
 *   - ALL_KEYS_EXHAUSTED — Freepik pool fully drained
 *   - CRON_PARTIAL       — purge job had a failure
 *   - PRICING_MISSING    — calculateCost saw an unknown combination
 *   - KEY_EXHAUSTED      — single key flipped to inactive
 */

type Level = "debug" | "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, event: string, fields: LogFields = {}): void {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  // Use the matching console method so log drains can route by severity.
  const line = JSON.stringify(payload);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

/** Serializable error fields — drop into the `fields` object of any log call. */
export function errFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      errMessage: err.message,
      errName: err.name,
      errStack: err.stack,
    };
  }
  return { err: String(err) };
}
