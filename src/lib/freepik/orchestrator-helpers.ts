/**
 * Internal helpers extracted from orchestrator.ts so the main flow
 * file stays under the project's 200-line guideline.
 *
 * These are not part of the public API — only `orchestrator.ts`
 * imports from here.
 */

import { db } from "@/lib/db/client";
import { usageLogs, type NewUsageLog } from "@/lib/db/schema";
import { refundCode } from "@/lib/auth/activation";
import { FreepikApiError } from "@/lib/freepik/errors";
import { errFields, log } from "@/lib/logger";

export interface LogUsageOpts {
  endpoint: "kling-v3" | "improve-prompt";
  tier?: "pro" | "std" | null;
  durationSeconds?: number | null;
  withAudio?: boolean;
  costEur: number;
}

export type OrchestrateResult<T> =
  | { ok: true; data: T; metadata: import("@/lib/auth/activation").CodeMetadata }
  | {
      ok: false;
      status: number;
      body: { error: string; message: string };
    };

/**
 * Decide whether a Freepik error means "this key is dead, rotate to
 * the next one". Quota exhaustion (402) is unambiguous; 401 = invalid
 * or revoked key (rotate). 403 is split: BAD_REQUEST stays as a
 * customer-facing error (don't drain the pool over a bad payload),
 * AUTH-ish 403 rotates. See base-client.ts for the discriminator.
 */
export function isKeyExhaustedError(err: unknown): boolean {
  if (!(err instanceof FreepikApiError)) return false;
  return err.code === "QUOTA_EXHAUSTED" || err.code === "AUTH";
}

/**
 * Best-effort refund. The original Freepik error needs to surface to
 * the caller, so we never let a refund failure shadow it — the worst
 * case here is a customer permanently overcharged for a request that
 * did nothing. We log REFUND_FAILED loudly so admin can reconcile.
 */
export async function refundIfCharged(
  codeId: string,
  costEur: number,
): Promise<void> {
  if (costEur <= 0) return;
  try {
    await refundCode(codeId, costEur);
  } catch (err) {
    // CRITICAL — must alert admin. Customer was charged for a request
    // that produced no video; reversing requires manual SQL.
    log.error("REFUND_FAILED", {
      codeId,
      amountEur: costEur,
      ...errFields(err),
    });
    // Future: insert into a pending_refunds table for cron-driven retry.
  }
}

/**
 * Persist one usage_logs row. Errors are caught + logged with all the
 * fields admin needs to replay the row by hand (audit P1-4).
 */
export async function logUsage(
  opts: LogUsageOpts,
  codeId: string,
  keyId: string | null,
  freepikTaskId: string | null,
  status: NewUsageLog["status"],
): Promise<void> {
  try {
    await db.insert(usageLogs).values({
      codeId,
      keyId,
      endpoint: opts.endpoint,
      tier: opts.tier ?? null,
      durationSeconds: opts.durationSeconds ?? null,
      withAudio: opts.withAudio ?? false,
      costEur: opts.costEur.toFixed(2),
      freepikTaskId,
      status,
    });
  } catch (err) {
    log.error("USAGE_LOG_INSERT_FAILED", {
      codeId,
      keyId,
      endpoint: opts.endpoint,
      tier: opts.tier ?? null,
      durationSeconds: opts.durationSeconds ?? null,
      withAudio: opts.withAudio ?? false,
      costEur: opts.costEur.toFixed(2),
      freepikTaskId,
      status,
      ...errFields(err),
    });
  }
}

/** Validation-failure → friendly client message. */
export function reasonMessage(reason: "not_found" | "inactive" | "expired"): string {
  switch (reason) {
    case "not_found":
      return "Activation code not found.";
    case "inactive":
      return "Activation code has been revoked.";
    case "expired":
      return "Activation code has expired.";
  }
}

/** Standard `OrchestrateResult` shape for the !ok branch. */
export function fail(
  status: number,
  error: string,
  message: string,
): OrchestrateResult<never> {
  return { ok: false, status, body: { error, message } };
}
