import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { refundCode } from "@/lib/auth/activation";
import { log } from "@/lib/logger";
import { logAndAlert } from "@/lib/alerts/telegram";

/**
 * Cron: GET /api/cron/sweep-orphan-charges (every 15min)
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Detects `usage_logs` rows that have been stuck in `status='pending'`
 * for over 15 minutes — these are charges that the orchestrator
 * committed (`CHARGE_COMMITTED`) but never observed a terminal poll or
 * webhook response. The customer was charged; the work either never
 * happened or completed without our knowing. Refund + alert.
 *
 * Why 15 minutes (bumped 2026-05-22 from 10):
 *   - Normal Kling 3 task: 20-60s end-to-end (POST → COMPLETED).
 *   - Slow 4K / multi-shot: 2-5min worst case.
 *   - Webhook delivery + retry budget: ~3min.
 *   - Magnific webhook delay observed up to 10min in burst conditions
 *     (when their queue is hot). Old 10-min cutoff fired the refund
 *     before the legitimate webhook arrived → 1+ task/day got
 *     double-finalized (refund issued, then COMPLETED video arrived).
 *     Bumping to 15min adds slack and aligns with the 15-min cron
 *     cadence (1 chance to catch tasks within 15-30min window).
 *
 * Why every 15min (not realtime):
 *   - Orphans are rare; we don't need sub-minute detection.
 *   - Realtime sweep would risk false-positive refunds for genuinely
 *     slow tasks that haven't finalised yet.
 *   - 15min keeps customer-visible "missing refund" window bounded.
 *
 * What this does NOT do:
 *   - Doesn't refund tasks that completed (`succeeded`) — their cost
 *     was correct.
 *   - Doesn't refund tasks already marked `refunded` — idempotent.
 *   - Doesn't touch `failed` rows — they may have been refunded at
 *     finalize time already; revisiting could double-refund.
 *
 * Audit trail: every refund emits `ORPHAN_CHARGE_REFUNDED` with the
 * task_id + code_id + amount so admin can correlate against
 * `CHARGE_INITIATED` / `CHARGE_COMMITTED` events.
 */

const ORPHAN_AGE_MINUTES = 15;
// Don't refund more than this in a single sweep — protects against
// runaway logic if the DB clock is off or status flag misses. If a
// sweep ever hits this cap admin gets a critical alert.
const MAX_REFUNDS_PER_SWEEP = 50;

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_MISCONFIGURED", {
      cron: "sweep-orphan-charges",
      reason: "CRON_SECRET not set",
    });
    return NextResponse.json(
      { error: "MISCONFIGURED", message: "CRON_SECRET not set" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "AUTH", message: "Unauthorized" },
      { status: 401 },
    );
  }

  const cutoff = new Date(Date.now() - ORPHAN_AGE_MINUTES * 60_000);
  log.info("ORPHAN_SWEEP_STARTED", {
    cutoff: cutoff.toISOString(),
    ageMinutes: ORPHAN_AGE_MINUTES,
  });

  // Find pending rows older than cutoff. Cost might be 0 (improve-prompt
  // failures don't deserve a refund); still mark them refunded for the
  // status-machine sanity but skip the refundCode() call.
  const orphans = await db
    .select({
      id: usageLogs.id,
      codeId: usageLogs.codeId,
      costEur: usageLogs.costEur,
      freepikTaskId: usageLogs.freepikTaskId,
      endpoint: usageLogs.endpoint,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.status, "pending"),
        lt(usageLogs.createdAt, cutoff),
      ),
    )
    .limit(MAX_REFUNDS_PER_SWEEP + 1);

  if (orphans.length === 0) {
    log.info("ORPHAN_SWEEP_CLEAN", { found: 0 });
    return NextResponse.json({ ok: true, found: 0, refunded: 0 });
  }

  // Sanity cap — if we found more than the cap, something is very
  // wrong (system-wide outage? bad clock? logic bug?). Bail with a
  // critical alert instead of refunding 50+ tasks blindly.
  if (orphans.length > MAX_REFUNDS_PER_SWEEP) {
    logAndAlert({
      severity: "critical",
      event: "ORPHAN_SWEEP_OVER_CAP",
      title: `Orphan sweep tìm thấy ${orphans.length}+ pending rows — bail out`,
      body:
        `Cap = ${MAX_REFUNDS_PER_SWEEP}. Có thể là outage system-wide hoặc bug. ` +
        `Cần admin check thủ công trước khi cron tiếp tục refund.`,
      fields: { found: orphans.length, cap: MAX_REFUNDS_PER_SWEEP },
    });
    return NextResponse.json(
      { ok: false, error: "OVER_CAP", found: orphans.length },
      { status: 500 },
    );
  }

  let refunded = 0;
  let refundFailed = 0;

  for (const o of orphans) {
    const cost = Number(o.costEur);
    try {
      // Atomically flip pending → refunded. Skip if another sweep
      // (or the finalize path) raced ahead — defensive idempotency.
      const flipped = await db
        .update(usageLogs)
        .set({
          status: "refunded",
          errorMessage: sql`COALESCE(${usageLogs.errorMessage}, 'ORPHAN_CHARGE_AUTO_REFUNDED')`,
        })
        .where(
          and(
            eq(usageLogs.id, o.id),
            eq(usageLogs.status, "pending"),
          ),
        )
        .returning({ id: usageLogs.id });

      if (flipped.length === 0) {
        // Raced — another caller flipped this row. Skip silently.
        log.info("ORPHAN_SKIPPED_RACED", { taskId: o.freepikTaskId, id: o.id });
        continue;
      }

      // Reverse the charge on the activation code. Improve-prompt has
      // cost 0; refundCode is a no-op for those.
      if (cost > 0) {
        await refundCode(o.codeId, cost);
      }

      logAndAlert({
        severity: "warn",
        event: "ORPHAN_CHARGE_REFUNDED",
        title: `Orphan refund: ${o.endpoint} ${cost.toFixed(2)} EUR`,
        body:
          `Task pending > ${ORPHAN_AGE_MINUTES} phút không có terminal poll/webhook. ` +
          `Đã refund tự động.`,
        fields: {
          taskId: o.freepikTaskId ?? "(no task_id)",
          codeId: o.codeId,
          costEur: cost.toFixed(2),
          createdAt: new Date(o.createdAt).toISOString(),
          ageMin: Math.round(
            (Date.now() - new Date(o.createdAt).getTime()) / 60_000,
          ),
        },
      });
      refunded++;
    } catch (err) {
      log.error("ORPHAN_REFUND_FAILED", {
        id: o.id,
        taskId: o.freepikTaskId,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      refundFailed++;
    }
  }

  log.info("ORPHAN_SWEEP_DONE", {
    found: orphans.length,
    refunded,
    refundFailed,
  });

  return NextResponse.json({
    ok: true,
    found: orphans.length,
    refunded,
    refundFailed,
  });
}
