import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { authedFreepikCall } from "@/lib/freepik/orchestrator";
import { finalizeUsageOnPoll } from "@/lib/freepik/orchestrator-helpers";
import { parseEndpointSlug } from "@/lib/freepik/kling-motion";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import {
  isR2Configured,
  mirrorRemoteToR2,
  r2KeyForVideo,
} from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";
import { stripBrandNames } from "@/lib/error-messages";
import type { TaskData } from "@/lib/freepik/types";

/**
 * GET /api/v1/tasks/[taskId]
 *
 * Universal task poll for every public-API job (kling-3, kling-3-4k-*,
 * kling-motion-*, prompt-improve). Reads `usage_logs.endpoint` to
 * dispatch to the right upstream client.
 *
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Response:
 *   {
 *     ok: true,
 *     task_id, status: "CREATED"|"IN_PROGRESS"|"COMPLETED"|"FAILED",
 *     generated: string[],   // result URLs once COMPLETED (video or text)
 *     error_message?: string // populated on FAILED
 *   }
 *
 * The poll endpoint is shared so customer code can write one polling
 * loop regardless of which generation model created the task.
 */

export const maxDuration = 60;

const RATE_LIMIT_PER_TASK = 60;
const RATE_WINDOW_SEC = 60;

type TaskRow = {
  endpoint: string;
  keyId: string | null;
  videoUrl: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  if (!taskId) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "taskId is required." },
      { status: 400 },
    );
  }

  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const rl = await checkRateLimit({
    resource: "v1-tasks-poll",
    scope: `${auth.apiKeyId}:${taskId}`,
    limit: RATE_LIMIT_PER_TASK,
    windowSeconds: RATE_WINDOW_SEC,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT",
        message: `Polling too fast — retry in ${rl.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  // Look up the usage_log row to discover which upstream endpoint
  // created this task. We need this both to dispatch to the right
  // client and to honour the creator-key constraint (Magnific only
  // returns task status to the account that POST'd the create).
  let row: TaskRow | null = null;
  try {
    const [hit] = await db
      .select({
        endpoint: usageLogs.endpoint,
        keyId: usageLogs.keyId,
        videoUrl: usageLogs.videoUrl,
      })
      .from(usageLogs)
      .where(eq(usageLogs.freepikTaskId, taskId))
      .limit(1);
    row = hit ?? null;
  } catch (err) {
    log.warn("V1_TASK_LOOKUP_FAILED", { taskId, ...errFields(err) });
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND", message: "Unknown task_id." },
      { status: 404 },
    );
  }

  const getter = upstreamGetterFor(row.endpoint, taskId);
  if (!getter) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNSUPPORTED",
        message: `Task endpoint "${row.endpoint}" is not pollable via this route.`,
      },
      { status: 400 },
    );
  }

  const result = await authedFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    preferredKeyId: row.keyId,
    callFreepik: getter,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const data = result.data;

  // Finalize lifecycle (mirror to R2 + write usage_logs). Same shape
  // as the per-endpoint /api/freepik/* poll routes. Errors swallowed —
  // the customer's poll succeeds even if mirror or DB write fails.
  try {
    if (data.status === "FAILED") {
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "UPSTREAM_FAILED",
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
      } else if (!row.videoUrl) {
        // Only mirror videos — improve-prompt returns text in
        // generated[0] which isn't a URL, skip R2 in that case.
        const isVideoEndpoint = row.endpoint !== "improve-prompt";
        let finalUrl = sourceUrl;
        if (isVideoEndpoint && isR2Configured()) {
          try {
            const mirrored = await mirrorRemoteToR2({
              sourceUrl,
              key: r2KeyForVideo(taskId),
              contentType: "video/mp4",
            });
            if (mirrored) finalUrl = mirrored;
          } catch (err) {
            log.warn("R2_MIRROR_UNEXPECTED", { taskId, ...errFields(err) });
          }
        }
        await finalizeUsageOnPoll({
          freepikTaskId: taskId,
          outcome: "succeeded",
          videoUrl: finalUrl,
          magnificVideoUrl: sourceUrl,
          videoUrlExpiresAt: isVideoEndpoint
            ? new Date(Date.now() + VIDEO_URL_TTL_MS)
            : null,
        });
        data.generated[0] = finalUrl;
      } else {
        // Already finalized by a prior poll — surface the stored URL.
        data.generated[0] = row.videoUrl;
      }
    }
  } catch (err) {
    log.warn("V1_POLL_FINALIZE_FAILED", { taskId, ...errFields(err) });
  }

  return NextResponse.json({
    ok: true,
    task_id: data.task_id,
    status: data.status,
    generated: data.generated,
    error_message: data.error_message
      ? stripBrandNames(data.error_message)
      : null,
  });
}

/**
 * Dispatch table — maps `usage_logs.endpoint` to the upstream getter.
 * Returns a curried function that authedFreepikCall can invoke with
 * just an apiKey.
 */
function upstreamGetterFor(
  endpoint: string,
  taskId: string,
): ((apiKey: string) => Promise<TaskData>) | null {
  switch (endpoint) {
    case "kling-v3":
      return (apiKey) => freepik.klingV3.getTask(taskId, { apiKey });
    case "kling-4k-t2v":
      return (apiKey) => freepik.kling4k.getTaskT2v(taskId, { apiKey });
    case "kling-4k-i2v":
      return (apiKey) => freepik.kling4k.getTaskI2v(taskId, { apiKey });
    case "improve-prompt":
      return (apiKey) => freepik.improvePrompt.getTask(taskId, { apiKey });
    default: {
      const motion = parseEndpointSlug(endpoint);
      if (motion) {
        return (apiKey) =>
          freepik.klingMotion.getTask(taskId, {
            version: motion.version,
            tier: motion.tier,
            apiKey,
          });
      }
      return null;
    }
  }
}
