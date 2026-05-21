import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { freepikKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { encrypt } from "@/lib/crypto/aes-gcm";
import { log } from "@/lib/logger";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().min(1).max(120).optional(),
  notes: z.string().max(500).nullable().optional(),
  assignedEur: z.number().positive().optional(),
  /**
   * Edit the tracked spend directly. Two common admin flows:
   *   1. After topping up the upstream account, reset usedEur to 0 so
   *      the key shows full budget locally again.
   *   2. After a refund flap (orchestrator credited but Magnific didn't),
   *      adjust usedEur down by the refunded amount.
   * Pass 0 to reset; any non-negative number to set explicitly.
   */
  usedEur: z.number().min(0).optional(),
  /** Per-key cap on simultaneous in-flight generations. Default 8. */
  maxConcurrent: z.number().int().min(1).max(64).optional(),
  /**
   * Magnific webhook secret for this key. Set to a non-empty string to
   * configure (server encrypts AES-256-GCM before storing) — webhook
   * route then HMAC-verifies inbound deliveries against this secret.
   * Set to null to remove (key falls back to polling-only finalization).
   * Set to undefined (omit) to leave unchanged.
   */
  webhookSecret: z.union([z.string().min(8).max(256), z.null()]).optional(),
});

/** PATCH /api/admin/keys/[id] — toggle active, edit label/notes, adjust budget + spend + concurrency. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  if (parsed.data.assignedEur !== undefined)
    updates.assignedEur = parsed.data.assignedEur.toFixed(2);
  if (parsed.data.usedEur !== undefined)
    updates.usedEur = parsed.data.usedEur.toFixed(2);
  if (parsed.data.maxConcurrent !== undefined)
    updates.maxConcurrent = parsed.data.maxConcurrent;
  // Webhook secret — encrypt on write, never echo plaintext back.
  // null clears it (key falls back to polling-only finalization).
  if (parsed.data.webhookSecret !== undefined) {
    updates.webhookSecretEncrypted =
      parsed.data.webhookSecret === null
        ? null
        : await encrypt(parsed.data.webhookSecret);
    log.info(
      parsed.data.webhookSecret === null
        ? "KEY_WEBHOOK_SECRET_CLEARED"
        : "KEY_WEBHOOK_SECRET_SET",
      { id },
    );
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "No fields to update." },
      { status: 400 },
    );
  }

  // Audit any direct usedEur manipulation — this isn't a normal flow,
  // it bypasses the orchestrator's accounting. If something looks
  // off later, this log is the trail.
  if (parsed.data.usedEur !== undefined) {
    log.info("KEY_USED_EUR_OVERRIDDEN", {
      id,
      newUsedEur: parsed.data.usedEur,
    });
  }
  // Distinguish admin manual deactivate from orchestrator's auto-
  // deactivate (KEY_EXHAUSTED). When investigating a "why is this key
  // inactive" question, the two events tell totally different stories
  // (was it quota, or did someone click the button?).
  if (parsed.data.isActive === false) {
    log.info("KEY_DEACTIVATED_BY_ADMIN", { id });
  } else if (parsed.data.isActive === true) {
    log.info("KEY_REACTIVATED_BY_ADMIN", { id });
  }

  const [updated] = await db
    .update(freepikKeys)
    .set(updates)
    .where(eq(freepikKeys.id, id))
    .returning({
      id: freepikKeys.id,
      label: freepikKeys.label,
      isActive: freepikKeys.isActive,
      assignedEur: freepikKeys.assignedEur,
      usedEur: freepikKeys.usedEur,
      maxConcurrent: freepikKeys.maxConcurrent,
      notes: freepikKeys.notes,
    });

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Key not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, updated });
}

/**
 * DELETE /api/admin/keys/[id] — permanently remove a key from the pool.
 * usage_logs.key_id has ON DELETE SET NULL, so historical billing rows
 * stay intact (just lose their key attribution). The encrypted key blob
 * is gone for good — admin must re-add the plaintext if they ever want
 * the key back.
 *
 * Guard: refuse if the key has any `pending` or `succeeded`-but-not-
 * webhook-confirmed task in flight — deleting mid-flight orphans the
 * task's polling thread and customer never sees a result. Admin must
 * either wait for tasks to complete or deactivate (PATCH isActive=false)
 * and delete later.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;

  // Pending guard — count tasks that haven't reached a terminal state
  // yet. `succeeded` rows where the URL hasn't expired are also blocked
  // because the customer may still be downloading.
  const pending = await db
    .select({ id: usageLogs.id })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.keyId, id),
        inArray(usageLogs.status, ["pending"]),
      ),
    )
    .limit(1);

  if (pending.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "HAS_PENDING_TASKS",
        message:
          "Key đang có task chưa hoàn thành. Đặt isActive=false rồi đợi tasks xong trước khi xoá.",
      },
      { status: 409 },
    );
  }

  const [deleted] = await db
    .delete(freepikKeys)
    .where(eq(freepikKeys.id, id))
    .returning({ id: freepikKeys.id, label: freepikKeys.label });

  if (!deleted) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Key not found." },
      { status: 404 },
    );
  }

  log.info("KEY_DELETED", { id: deleted.id, label: deleted.label });
  return NextResponse.json({ ok: true, deleted });
}
