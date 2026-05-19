import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { parseTierParam } from "@/lib/freepik/kling-motion-schema";
import { authedFreepikCall } from "@/lib/freepik/orchestrator";
import {
  extractActivationCode,
} from "@/lib/freepik/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import { finalizeUsageOnPoll } from "@/lib/freepik/orchestrator-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import { isR2Configured, mirrorRemoteToR2, r2KeyForVideo } from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/freepik/kling-motion/[tier]/[taskId]
 *
 * Poll-then-finalize for the 4 Kling Motion endpoints. Same lifecycle
 * as kling-v3 / wan-v27 poll routes: pending → succeeded on
 * COMPLETED+url, → refunded on FAILED / empty generated[].
 *
 * Written inline (not via createTaskGetHandler) because the upstream
 * getter needs (version, tier) bound per-request from the URL dynamic
 * segment — the factory's getter signature only takes apiKey.
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
        message: `Unknown tier: ${tierParam}. Expected v2-6-std | v2-6-pro | v3-std | v3-pro.`,
      },
      { status: 400 },
    );
  }
  const { version, tier } = parsedTier;
  const resource = `kling-motion-${tierParam}-poll`;

  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource,
        // Per-(code, task) scope — same reasoning as createTaskGetHandler.
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

  // Same preferredKeyId optimisation as createTaskGetHandler — pick
  // the key that created the task so we don't see 404s from other
  // accounts in the pool.
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
      freepik.klingMotion.getTask(taskId, { version, tier, apiKey }),
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const data = result.data;

  // Finalize lifecycle — same shape as wan-v27 / kling-v3 poll routes.
  try {
    if (data.status === "FAILED") {
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
