import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { parseTierParam } from "@/lib/freepik/kling-omni-schema";
import { authedFreepikCall } from "@/lib/freepik/orchestrator";
import { extractActivationCode } from "@/lib/freepik/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import { finalizeUsageOnPoll } from "@/lib/freepik/orchestrator-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import {
  isR2Configured,
  mirrorRemoteToR2,
  r2KeyForVideo,
} from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/freepik/kling-omni/[tier]/[taskId]
 *
 * Poll for Kling 3 Omni tasks. The [tier] segment tells us which
 * upstream NAMESPACE to query (video vs reference-to-video) — tier
 * itself doesn't matter for GET (Magnific serves both std + pro
 * from one endpoint per namespace).
 *
 * Same finalize lifecycle as kling-motion / kling-v3:
 *   COMPLETED + url → R2 mirror, then status='succeeded'
 *   COMPLETED + no url → status='refunded' + refund (COMPLETED_WITHOUT_URL)
 *   FAILED → status='refunded' + refund (MAGNIFIC_FAILED)
 */

export const maxDuration = 60;
const RATE_LIMIT = { limit: 60, windowSeconds: 60 };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tier: string; taskId: string }> },
) {
  const { tier: tierParam, taskId } = await params;
  if (!taskId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "taskId is required." },
      { status: 400 },
    );
  }
  const parsedTier = parseTierParam(tierParam);
  if (!parsedTier) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: `Unknown tier: ${tierParam}. Expected omni-std | omni-pro | omni-ref-std | omni-ref-pro.`,
      },
      { status: 400 },
    );
  }
  const { mode } = parsedTier;
  const resource = `kling-omni-${tierParam}-poll`;

  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource,
        scope: `${validation.metadata.codeId}:${taskId}`,
        limit: RATE_LIMIT.limit,
        windowSeconds: RATE_LIMIT.windowSeconds,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Polling too fast — wait ${rl.retryAfterSeconds}s.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  // Honour creator-key constraint — Magnific only returns task status
  // to the account that POST'd the create call (audit 2026-05-12).
  let preferredKeyId: string | null = null;
  try {
    const [row] = await db
      .select({ keyId: usageLogs.keyId })
      .from(usageLogs)
      .where(eq(usageLogs.freepikTaskId, taskId))
      .limit(1);
    if (row?.keyId) preferredKeyId = row.keyId;
  } catch (err) {
    log.warn("POLL_KEY_LOOKUP_FAILED", { taskId, ...errFields(err) });
  }

  const result = await authedFreepikCall({
    bearerCode: bearer,
    preValidated: validation,
    preferredKeyId,
    callFreepik: (apiKey) =>
      freepik.klingOmni.getTask(taskId, { mode, apiKey }),
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const data = result.data;

  try {
    if (data.status === "FAILED") {
      // TEMP DIAG (2026-05-22): Omni tasks failing fast with no upstream
      // reason — dump raw response so we can see what Magnific actually
      // returns. Remove after root cause identified.
      log.warn("OMNI_TASK_FAILED_DEBUG", {
        taskId,
        tier: tierParam,
        rawData: JSON.stringify(data),
      });
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "MAGNIFIC_FAILED",
        upstreamErrorMessage: data.error_message ?? null,
      });
    } else if (data.status === "COMPLETED") {
      const sourceUrl = data.generated[0];
      if (!sourceUrl) {
        await finalizeUsageOnPoll({
          freepikTaskId: taskId,
          outcome: "failed",
          failureReason: "COMPLETED_WITHOUT_URL",
        });
      } else {
        const [existing] = await db
          .select({ videoUrl: usageLogs.videoUrl })
          .from(usageLogs)
          .where(eq(usageLogs.freepikTaskId, taskId))
          .limit(1);

        if (existing?.videoUrl) {
          data.generated[0] = existing.videoUrl;
        } else {
          let videoUrl = sourceUrl;
          if (isR2Configured()) {
            try {
              const mirrored = await mirrorRemoteToR2({
                sourceUrl,
                key: r2KeyForVideo(taskId),
                contentType: "video/mp4",
              });
              if (mirrored) videoUrl = mirrored;
            } catch (err) {
              log.warn("R2_MIRROR_UNEXPECTED", { taskId, ...errFields(err) });
            }
          }
          await finalizeUsageOnPoll({
            freepikTaskId: taskId,
            outcome: "succeeded",
            videoUrl,
            magnificVideoUrl: sourceUrl,
            videoUrlExpiresAt: new Date(Date.now() + VIDEO_URL_TTL_MS),
          });
          data.generated[0] = videoUrl;
        }
      }
    }
  } catch (err) {
    log.warn("POLL_ONSUCCESS_FAILED", { taskId, ...errFields(err) });
  }

  return NextResponse.json({ data });
}
