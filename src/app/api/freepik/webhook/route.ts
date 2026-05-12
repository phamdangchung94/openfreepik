import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { finalizeUsageOnPoll } from "@/lib/freepik/orchestrator-helpers";
import { getKeyWebhookSecrets } from "@/lib/freepik/key-pool";
import { verifyMagnificWebhook } from "@/lib/freepik/webhook-verify";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import { isR2Configured, mirrorRemoteToR2, r2KeyForVideo } from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/freepik/webhook
 *
 * Magnific posts task-completion callbacks here. We try every pool
 * key's webhook secret against the Svix-style signature header until
 * one matches; the matched key tells us which Magnific account fired
 * the event (for audit) but the usage_log row is found via the
 * freepik_task_id in the payload.
 *
 * On COMPLETED + url → R2 mirror, finalize usage_log as 'succeeded'.
 * On FAILED or COMPLETED+no-url → finalize 'refunded' (refund + flip).
 *
 * Idempotent via finalizeUsageOnPoll's status='pending' guard, so
 * webhook + client poll can both race the same task without
 * double-charging or double-refunding.
 */

// Mirror download can take 5-15s for large 4K renders.
export const maxDuration = 60;

/**
 * Upstream webhook body shape. The `generated` field is string[] across
 * every endpoint we support today; FAILED deliveries also frequently
 * (but not always) carry a free-text reason whose field name varies —
 * we accept any of the common ones and normalise to `errorMessage` at
 * the route level so the downstream pipeline sees one shape.
 */
const payloadSchema = z.object({
  task_id: z.string().min(1),
  status: z.enum(["CREATED", "IN_PROGRESS", "COMPLETED", "FAILED"]),
  generated: z.array(z.string()).optional().default([]),
  error: z.string().optional(),
  reason: z.string().optional(),
  error_message: z.string().optional(),
  message: z.string().optional(),
  failure_reason: z.string().optional(),
});

/** Pluck whichever reason field the upstream populated, or null. */
function extractUpstreamError(
  p: z.infer<typeof payloadSchema>,
): string | null {
  return (
    p.error_message ??
    p.failure_reason ??
    p.reason ??
    p.error ??
    p.message ??
    null
  );
}

export async function POST(request: Request) {
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Missing webhook headers" },
      { status: 400 },
    );
  }

  // Read the body once as text so signature verification gets the
  // exact bytes Magnific signed. Then parse as JSON separately.
  const rawBody = await request.text();

  // Find the right secret. We don't know which pool key Magnific used,
  // but each key has a per-account webhook secret — try each. On
  // match we get the key id to attribute the event to.
  const candidates = await getKeyWebhookSecrets();
  if (candidates.length === 0) {
    log.warn("WEBHOOK_NO_SECRETS_CONFIGURED", { webhookId });
    return NextResponse.json(
      { error: "NOT_CONFIGURED", message: "No webhook secrets configured" },
      { status: 503 },
    );
  }

  let matchedKeyId: string | null = null;
  let matchedEncoding: string | null = null;
  let matchedPayloadFormat: string | null = null;
  // Collect per-candidate diagnostics so a mismatch can be debugged
  // without re-deploying instrumentation. Only the first 12 chars of
  // each signature are kept — enough to spot which encoding is close,
  // not enough to reverse the secret.
  const diagnostics: Array<{
    keyLabel: string;
    receivedSigPrefixes?: string[];
    computedSigs?: { encoding: string; sigPrefix: string }[];
    signedPayloadLen?: number;
  }> = [];

  for (const c of candidates) {
    const result = await verifyMagnificWebhook({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      secret: c.webhookSecret,
    });
    if (result.ok) {
      matchedKeyId = c.id;
      matchedEncoding = result.matchedEncoding;
      matchedPayloadFormat = result.matchedPayloadFormat;
      break;
    }
    if (result.reason === "mismatch") {
      diagnostics.push({
        keyLabel: c.label,
        receivedSigPrefixes: result.receivedSigPrefixes,
        computedSigs: result.computedSigs,
        signedPayloadLen: result.signedPayloadLen,
      });
    }
  }

  if (!matchedKeyId) {
    log.warn("WEBHOOK_SIGNATURE_MISMATCH", {
      webhookId,
      webhookTimestamp,
      sigHeaderLen: webhookSignature.length,
      candidateCount: candidates.length,
      // Show diagnostics for first key only — log size matters and
      // all keys typically hit the same root-cause anyway.
      firstKey: diagnostics[0],
    });
    return NextResponse.json(
      { error: "BAD_SIGNATURE", message: "Signature did not verify" },
      { status: 401 },
    );
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    log.error("WEBHOOK_BAD_PAYLOAD", { webhookId, ...errFields(err) });
    return NextResponse.json(
      { error: "BAD_PAYLOAD", message: "Unrecognized payload shape" },
      { status: 400 },
    );
  }

  log.info("WEBHOOK_RECEIVED", {
    webhookId,
    matchedKeyId,
    matchedEncoding,
    matchedPayloadFormat,
    freepikTaskId: payload.task_id,
    status: payload.status,
    hasUrl: payload.generated.length > 0,
  });

  if (payload.status === "FAILED") {
    await finalizeUsageOnPoll({
      freepikTaskId: payload.task_id,
      outcome: "failed",
      failureReason: "MAGNIFIC_FAILED_VIA_WEBHOOK",
      upstreamErrorMessage: extractUpstreamError(payload),
    });
    return NextResponse.json({ ok: true });
  }

  if (payload.status !== "COMPLETED") {
    // CREATED / IN_PROGRESS — Magnific shouldn't normally fire these
    // but if it does, no-op. The next status change will arrive.
    return NextResponse.json({ ok: true });
  }

  const magnificUrl = payload.generated[0];
  if (!magnificUrl) {
    await finalizeUsageOnPoll({
      freepikTaskId: payload.task_id,
      outcome: "failed",
      failureReason: "COMPLETED_WITHOUT_URL_VIA_WEBHOOK",
    });
    return NextResponse.json({ ok: true });
  }

  // Skip work if a poll-side path already mirrored this task. The
  // finalize helper is idempotent via its status='pending' guard, but
  // the R2 mirror download is expensive — short-circuit explicitly.
  const [existing] = await db
    .select({ videoUrl: usageLogs.videoUrl })
    .from(usageLogs)
    .where(eq(usageLogs.freepikTaskId, payload.task_id))
    .limit(1);

  if (existing?.videoUrl) {
    return NextResponse.json({ ok: true, alreadyMirrored: true });
  }

  // R2 mirror (best-effort — fall back to Magnific URL on failure).
  let videoUrl = magnificUrl;
  if (isR2Configured()) {
    try {
      const mirrored = await mirrorRemoteToR2({
        sourceUrl: magnificUrl,
        key: r2KeyForVideo(payload.task_id),
        contentType: "video/mp4",
      });
      if (mirrored) videoUrl = mirrored;
    } catch (err) {
      log.warn("WEBHOOK_R2_MIRROR_UNEXPECTED", {
        taskId: payload.task_id,
        ...errFields(err),
      });
    }
  }

  await finalizeUsageOnPoll({
    freepikTaskId: payload.task_id,
    outcome: "succeeded",
    videoUrl,
    magnificVideoUrl: magnificUrl,
    videoUrlExpiresAt: new Date(Date.now() + VIDEO_URL_TTL_MS),
  });

  return NextResponse.json({ ok: true });
}
