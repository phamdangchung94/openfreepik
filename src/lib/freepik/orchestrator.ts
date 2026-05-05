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

import {
  chargeCode,
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
import { errFields, log } from "@/lib/logger";
import {
  fail,
  isKeyExhaustedError,
  logUsage,
  reasonMessage,
  refundIfCharged,
  type OrchestrateResult,
} from "./orchestrator-helpers";

// Re-export for callers that import the result type from this module.
export type { OrchestrateResult } from "./orchestrator-helpers";

const MAX_KEY_RETRIES = 3;

/**
 * Audit #5: emit CHARGE_SLOW after this many ms if the orchestrator
 * hasn't returned. Set 5s to fire well before Vercel's 10s function
 * timeout so admin sees the warning in logs even when the function gets
 * killed mid-Freepik-call. Tunable.
 */
const SLOW_CHARGE_WARN_MS = 5_000;

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

  // Audit #5 — pair an INTENT log before charge with a COMMITTED log
  // after success. If admin sees CHARGE_INITIATED for a requestId without
  // a matching CHARGE_COMMITTED within ~5 minutes, the function crashed
  // mid-flight and the customer's balance needs manual reconciliation.
  // Slow-call watchdog separately fires if we're still running after
  // SLOW_CHARGE_WARN_MS (visible even if the function gets timeout-killed).
  const requestId = crypto.randomUUID();
  const startMs = Date.now();
  const slowTimer = setTimeout(() => {
    log.warn("CHARGE_SLOW", {
      requestId,
      endpoint: opts.endpoint,
      codeId,
      costEur: opts.costEur,
      elapsedMs: Date.now() - startMs,
    });
  }, SLOW_CHARGE_WARN_MS);

  try {
    return await runOrchestrate(opts, validation.metadata, codeId, requestId, startMs);
  } finally {
    clearTimeout(slowTimer);
  }
}

async function runOrchestrate<T>(
  opts: OrchestrateOptions<T>,
  initialMetadata: CodeMetadata,
  codeId: string,
  requestId: string,
  startMs: number,
): Promise<OrchestrateResult<T>> {
  // Skip charging entirely for free endpoints (cost=0).
  let metadataAfterCharge: CodeMetadata = initialMetadata;
  if (opts.costEur > 0) {
    log.info("CHARGE_INITIATED", {
      requestId,
      endpoint: opts.endpoint,
      codeId,
      costEur: opts.costEur,
    });
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
  // Audit P1-3: track keys tried in this request so the retry loop
  // doesn't pick the same key 3× when the pool has only 1 active key.
  // Each attempt adds the key id to this set; pickActiveKey excludes
  // them from the LRU candidate list.
  const triedKeyIds = new Set<string>();

  for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
    const key = await pickActiveKey(opts.costEur, triedKeyIds);
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

      // P0-2: Freepik occasionally returns 200 with a malformed body. If
      // we can't extract a task_id, the customer has nothing to poll —
      // treat as a failure (refund + 502) instead of charging silently.
      const taskId = opts.extractTaskId?.(data) ?? null;
      if (opts.extractTaskId && !taskId) {
        log.error("EXTRACT_TASKID_FAILED", {
          requestId,
          endpoint: opts.endpoint,
          codeId,
          keyId: key.id,
        });
        await refundIfCharged(codeId, opts.costEur);
        await logUsage(opts, codeId, key.id, null, "failed");
        return fail(
          502,
          "UPSTREAM_MALFORMED",
          "Freepik returned an unexpected response — refunded.",
        );
      }

      // P0-1: tracking writes happen AFTER the Freepik task is created.
      // If they throw, the catch below would refund + retry, but the
      // task already exists on Freepik's side and pool credit is gone.
      // Wrap in their own try so we keep `ok:true` and bill the
      // customer; admin gets a POST_CHARGE_TRACKING_FAILED log to
      // reconcile the pool spend manually.
      try {
        await recordKeyCost(key.id, opts.costEur);
        await logUsage(opts, codeId, key.id, taskId, "succeeded");
      } catch (trackErr) {
        log.error("POST_CHARGE_TRACKING_FAILED", {
          requestId,
          endpoint: opts.endpoint,
          codeId,
          keyId: key.id,
          freepikTaskId: taskId,
          costEur: opts.costEur,
          ...errFields(trackErr),
        });
        // Don't rethrow — customer's request DID succeed upstream.
      }

      if (opts.costEur > 0) {
        log.info("CHARGE_COMMITTED", {
          requestId,
          endpoint: opts.endpoint,
          codeId,
          keyId: key.id,
          freepikTaskId: taskId,
          costEur: opts.costEur,
          elapsedMs: Date.now() - startMs,
        });
      }
      return { ok: true, data, metadata: metadataAfterCharge };
    } catch (err) {
      lastErr = err;
      // PLAN_LIMIT: Magnific account hit its plan ceiling. The key
      // itself is fine — it'll work again when the plan resets. Rotate
      // to the next key for THIS request, but DON'T flip is_active so
      // the next request a few minutes later doesn't see an empty pool.
      // (Without this branch, every plan-limited request silently drains
      // the pool — the customer's "Tạm thời chưa có key khả dụng" loop.)
      if (err instanceof FreepikApiError && err.code === "PLAN_LIMIT") {
        log.warn("KEY_PLAN_LIMIT", {
          requestId,
          keyId: key.id,
          label: key.label,
          endpoint: opts.endpoint,
          message: err.message.slice(0, 200),
        });
        triedKeyIds.add(key.id); // exclude from THIS request's retries
        continue; // try the next key — but key stays is_active=true
      }
      if (isKeyExhaustedError(err)) {
        // P0-7: emit the documented KEY_EXHAUSTED event so admin has
        // observability when a key flips inactive. Without this the
        // pool can drain silently and admin only finds out via the
        // ALL_KEYS_EXHAUSTED panic at the end.
        log.warn("KEY_EXHAUSTED", {
          requestId,
          keyId: key.id,
          endpoint: opts.endpoint,
          ...errFields(err),
        });
        await markKeyExhausted(key.id);
        triedKeyIds.add(key.id); // P1-3
        continue; // try the next key
      }
      // Non-quota error — refund and bubble up.
      await refundIfCharged(codeId, opts.costEur);
      await logUsage(opts, codeId, key.id, null, "failed");
      if (err instanceof FreepikApiError) {
        return fail(err.status || 500, err.code, err.message);
      }
      log.error("ORCHESTRATOR_UNEXPECTED", {
        requestId,
        endpoint: opts.endpoint,
        codeId,
        keyId: key.id,
        ...errFields(err),
      });
      return fail(500, "UNKNOWN", "An unexpected error occurred.");
    }
  }

  // All retries used up — last error was a quota-exhaustion on every key.
  await refundIfCharged(codeId, opts.costEur);
  await logUsage(opts, codeId, null, null, "refunded");
  // Audit P1-11: bumped from warn → error. This is the panic path —
  // every key in the pool is dead and customers are getting refunded
  // requests. Log drains often filter `warn` out of alert pipelines
  // so this needs to surface at the highest level.
  log.error("ALL_KEYS_EXHAUSTED", {
    requestId,
    endpoint: opts.endpoint,
    codeId,
    costEur: opts.costEur,
    ...errFields(lastErr),
  });
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
  /** Reuse a validation result from a route-level rate-limit check. */
  preValidated?: ValidationResult;
}): Promise<OrchestrateResult<T>> {
  if (!opts.bearerCode) {
    return fail(401, "AUTH", "Activation code is required.");
  }

  const validation = opts.preValidated ?? (await validateCode(opts.bearerCode));
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
    log.error("AUTHED_CALL_UNEXPECTED", {
      keyId: key.id,
      ...errFields(err),
    });
    return fail(500, "UNKNOWN", "An unexpected error occurred.");
  }
}

