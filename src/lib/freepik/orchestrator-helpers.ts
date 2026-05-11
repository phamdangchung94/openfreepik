/**
 * Internal helpers extracted from orchestrator.ts so the main flow
 * file stays under the project's 200-line guideline.
 *
 * These are not part of the public API — only `orchestrator.ts`
 * imports from here.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs, type NewUsageLog } from "@/lib/db/schema";
import { refundCode } from "@/lib/auth/activation";
import { FreepikApiError } from "@/lib/freepik/errors";
import { errFields, log } from "@/lib/logger";

export interface LogUsageOpts {
  endpoint: "kling-v3" | "wan-v27" | "improve-prompt";
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
 * Decide whether a Freepik error means "this key is permanently dead,
 * flip is_active=false". CONSERVATIVE on purpose — auto-disabling on
 * vague 401/403s caused a whack-a-mole loop where customers exhausted
 * the pool every time Magnific had a transient hiccup.
 *
 * Only QUOTA_EXHAUSTED (HTTP 402) qualifies: that's Magnific saying
 * "this account is out of credit", which is unambiguous and permanent
 * until the customer tops up.
 *
 * Everything else — 401, 403, 5xx, network — is treated as "rotate for
 * THIS request only" by the orchestrator's per-request `triedKeyIds`
 * set. Admin sees a `KEY_TRANSIENT_FAILURE` log and can disable a key
 * by hand if needed.
 */
export function isKeyExhaustedError(err: unknown): boolean {
  if (!(err instanceof FreepikApiError)) return false;
  return err.code === "QUOTA_EXHAUSTED";
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

/**
 * Finalize a pending usage_logs row once polling reaches a terminal
 * state. The customer contract is: charge sticks only when the
 * customer can receive a working video URL. Anything else flips the
 * row to status='refunded' AND restores the balance.
 *
 * Idempotent — guarded by `WHERE status = 'pending'` so concurrent
 * polls / a reconcile-script overlap can't double-refund.
 *
 * Use `outcome='succeeded'` only when you actually have a URL to hand
 * the customer. Magnific FAILED, empty generated[], or function-killed
 * orphans all funnel through `outcome='failed'`.
 */
export interface FinalizeUsageOpts {
  freepikTaskId: string;
  outcome: "succeeded" | "failed";
  /** Set when outcome='succeeded' — the URL persisted to the row. */
  videoUrl?: string | null;
  magnificVideoUrl?: string | null;
  videoUrlExpiresAt?: Date | null;
  /** Tag for the refund log (e.g. "MAGNIFIC_FAILED", "NO_VIDEO_URL"). */
  failureReason?: string;
}

export async function finalizeUsageOnPoll(
  opts: FinalizeUsageOpts,
): Promise<void> {
  if (opts.outcome === "succeeded") {
    if (!opts.videoUrl) {
      // Defensive — caller asked for "succeeded" without a URL. Bug, but
      // treat as failure rather than silently swallowing.
      log.warn("FINALIZE_SUCCEEDED_WITHOUT_URL", {
        freepikTaskId: opts.freepikTaskId,
      });
      return finalizeUsageOnPoll({ ...opts, outcome: "failed", failureReason: "MISSING_URL" });
    }
    await db
      .update(usageLogs)
      .set({
        status: "succeeded",
        videoUrl: opts.videoUrl,
        magnificVideoUrl: opts.magnificVideoUrl ?? opts.videoUrl,
        videoUrlExpiresAt: opts.videoUrlExpiresAt ?? null,
      })
      .where(
        and(
          eq(usageLogs.freepikTaskId, opts.freepikTaskId),
          eq(usageLogs.status, "pending"),
        ),
      );
    return;
  }

  // outcome === "failed" — atomically flip to refunded + recover the
  // row's codeId/costEur in the same statement so concurrent polls
  // can't double-refund.
  const updated = await db
    .update(usageLogs)
    .set({ status: "refunded" })
    .where(
      and(
        eq(usageLogs.freepikTaskId, opts.freepikTaskId),
        eq(usageLogs.status, "pending"),
      ),
    )
    .returning({
      codeId: usageLogs.codeId,
      costEur: usageLogs.costEur,
    });

  const [row] = updated;
  if (!row) return; // already finalized by a concurrent path

  const cost = Number(row.costEur);
  if (cost <= 0) return;

  try {
    await refundCode(row.codeId, cost);
    log.info("POLL_REFUND_ISSUED", {
      freepikTaskId: opts.freepikTaskId,
      codeId: row.codeId,
      amountEur: cost,
      reason: opts.failureReason ?? "POLL_FAILED",
    });
  } catch (err) {
    // CRITICAL — row already marked refunded but balance not restored.
    // Admin needs to reconcile manually. Same alert path as
    // REFUND_FAILED in refundIfCharged.
    log.error("POLL_REFUND_FAILED", {
      freepikTaskId: opts.freepikTaskId,
      codeId: row.codeId,
      amountEur: cost,
      reason: opts.failureReason ?? "POLL_FAILED",
      ...errFields(err),
    });
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
