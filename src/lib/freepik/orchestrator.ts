/**
 * Wraps every Freepik request the customer-facing routes make.
 *
 * Per-request lifecycle:
 *   1. validateCode      → 401 if missing / inactive / expired
 *   2. chargeCode        → 402 if insufficient balance (skipped when cost=0)
 *   3. retry loop (≤ MAX_RETRIES):
 *        pickActiveKey(cost) → 503 if pool exhausted
 *        callFreepik(decryptedKey)
 *          on success  → recordKeyCost, log usage, return data
 *          on quota    → markKeyExhausted, try next key
 *          on other    → refund, log usage as failed, surface error
 *   4. all retries exhausted → refund, log usage as refunded, 503
 */

import { db } from "@/lib/db/client";
import { usageLogs, type NewUsageLog } from "@/lib/db/schema";
import {
  chargeCode,
  refundCode,
  validateCode,
  type CodeMetadata,
  type ValidationResult,
} from "@/lib/auth/activation";
import { FreepikApiError } from "@/lib/freepik/errors";
import {
  markKeyExhausted,
  pickActiveKey,
  recordKeyCost,
} from "@/lib/freepik/key-pool";

const MAX_KEY_RETRIES = 3;

export interface OrchestrateOptions<T> {
  bearerCode: string | null;
  endpoint: "kling-v3" | "improve-prompt";
  costEur: number;
  /** Persisted to usage_logs for filtering — e.g. "pro"/"std" */
  tier?: "pro" | "std" | null;
  durationSeconds?: number | null;
  withAudio?: boolean;
  /** Closure that performs the Freepik HTTP call with the chosen key. */
  callFreepik: (apiKey: string) => Promise<T>;
  /** Extract the Freepik task_id from the response, for logging. */
  extractTaskId?: (data: T) => string | null;
  /**
   * Validation result reused from the caller (e.g. when a route handler
   * already validated the code for a rate-limit gate). Skips one DB
   * roundtrip — see audit #11 W1.
   */
  preValidated?: ValidationResult;
}

export type OrchestrateResult<T> =
  | { ok: true; data: T; metadata: CodeMetadata }
  | {
      ok: false;
      status: number;
      body: { error: string; message: string };
    };

export async function orchestrateFreepikCall<T>(
  opts: OrchestrateOptions<T>,
): Promise<OrchestrateResult<T>> {
  if (!opts.bearerCode) {
    return fail(401, "AUTH", "Activation code is required.");
  }

  const validation = opts.preValidated ?? (await validateCode(opts.bearerCode));
  if (!validation.ok) {
    return fail(401, validation.reason.toUpperCase(), reasonMessage(validation.reason));
  }

  const codeId = validation.metadata.codeId;

  // Skip charging entirely for free endpoints (cost=0).
  let metadataAfterCharge: CodeMetadata = validation.metadata;
  if (opts.costEur > 0) {
    const charged = await chargeCode(codeId, opts.costEur);
    if (!charged) {
      return fail(
        402,
        "INSUFFICIENT_BALANCE",
        "Activation code has insufficient balance for this request.",
      );
    }
    metadataAfterCharge = charged;
  }

  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
    const key = await pickActiveKey(opts.costEur);
    if (!key) {
      await refundIfCharged(codeId, opts.costEur);
      await logUsage(opts, codeId, null, null, "refunded");
      return fail(
        503,
        "NO_KEYS_AVAILABLE",
        "No Freepik keys with sufficient budget — please contact support.",
      );
    }

    try {
      const data = await opts.callFreepik(key.decryptedKey);
      await recordKeyCost(key.id, opts.costEur);
      const taskId = opts.extractTaskId?.(data) ?? null;
      await logUsage(opts, codeId, key.id, taskId, "succeeded");
      return { ok: true, data, metadata: metadataAfterCharge };
    } catch (err) {
      lastErr = err;
      if (isKeyExhaustedError(err)) {
        await markKeyExhausted(key.id);
        continue; // try the next key
      }
      // Non-quota error — refund and bubble up.
      await refundIfCharged(codeId, opts.costEur);
      await logUsage(opts, codeId, key.id, null, "failed");
      if (err instanceof FreepikApiError) {
        return fail(err.status || 500, err.code, err.message);
      }
      console.error("[orchestrator] unexpected error:", err);
      return fail(500, "UNKNOWN", "An unexpected error occurred.");
    }
  }

  // All retries used up — last error was a quota-exhaustion on every key.
  await refundIfCharged(codeId, opts.costEur);
  await logUsage(opts, codeId, null, null, "refunded");
  console.warn("[orchestrator] all keys exhausted after retries:", lastErr);
  return fail(
    503,
    "ALL_KEYS_EXHAUSTED",
    "All Freepik keys ran out of credit — please contact support.",
  );
}

/**
 * Lightweight variant for GET poll routes — validates the code, picks a
 * key, and forwards. No charging, no usage log (polling fires every few
 * seconds and would flood the table). Marks the key exhausted on quota
 * errors so the next caller skips it.
 */
export async function authedFreepikCall<T>(opts: {
  bearerCode: string | null;
  callFreepik: (apiKey: string) => Promise<T>;
}): Promise<OrchestrateResult<T>> {
  if (!opts.bearerCode) {
    return fail(401, "AUTH", "Activation code is required.");
  }

  const validation = await validateCode(opts.bearerCode);
  if (!validation.ok) {
    return fail(
      401,
      validation.reason.toUpperCase(),
      reasonMessage(validation.reason),
    );
  }

  const key = await pickActiveKey(0);
  if (!key) {
    return fail(503, "NO_KEYS_AVAILABLE", "No Freepik keys available.");
  }

  try {
    const data = await opts.callFreepik(key.decryptedKey);
    return { ok: true, data, metadata: validation.metadata };
  } catch (err) {
    if (isKeyExhaustedError(err)) {
      await markKeyExhausted(key.id);
    }
    if (err instanceof FreepikApiError) {
      return fail(err.status || 500, err.code, err.message);
    }
    console.error("[authedFreepikCall] unexpected error:", err);
    return fail(500, "UNKNOWN", "An unexpected error occurred.");
  }
}

function isKeyExhaustedError(err: unknown): boolean {
  if (!(err instanceof FreepikApiError)) return false;
  // 402 is unambiguous quota exhaustion. 401 could be either invalid key
  // or quota — treat as exhausted in both cases (the key is unusable
  // either way, we should rotate to the next one).
  return err.code === "QUOTA_EXHAUSTED" || err.code === "AUTH";
}

/**
 * Best-effort refund. The original Freepik error needs to surface to the
 * caller, so we never let a refund failure shadow it — the worst case
 * here is a customer permanently overcharged for a request that did
 * nothing, which audit #4 logs loudly so admin can manually reconcile.
 */
async function refundIfCharged(codeId: string, costEur: number): Promise<void> {
  if (costEur <= 0) return;
  try {
    await refundCode(codeId, costEur);
  } catch (err) {
    console.error(
      `[REFUND-FAILED] codeId=${codeId} amount=${costEur.toFixed(2)} EUR — ` +
        "manual reconciliation required",
      err,
    );
    // Future: insert into a pending_refunds table for cron-driven retry.
  }
}

async function logUsage<T>(
  opts: OrchestrateOptions<T>,
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
    // Logging is best-effort — don't fail the request if the log insert fails.
    console.error("[orchestrator] usage log insert failed:", err);
  }
}

function reasonMessage(reason: "not_found" | "inactive" | "expired"): string {
  switch (reason) {
    case "not_found":
      return "Activation code not found.";
    case "inactive":
      return "Activation code has been revoked.";
    case "expired":
      return "Activation code has expired.";
  }
}

function fail(
  status: number,
  error: string,
  message: string,
): OrchestrateResult<never> {
  return { ok: false, status, body: { error, message } };
}
