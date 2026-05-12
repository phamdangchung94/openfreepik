import { eq } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";
import { finalizeUsageOnPoll } from "@/lib/freepik/orchestrator-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import { isR2Configured, mirrorRemoteToR2, r2KeyForVideo } from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/freepik/wan-v27/[taskId]
 *
 * Drives the same usage_logs lifecycle as kling-v3 poll — pending →
 * succeeded on COMPLETED+url, → refunded on FAILED / empty generated[].
 */
export const maxDuration = 60;

export const GET = createTaskGetHandler(freepik.wanV27.getTask, {
  rateLimit: { resource: "wan-v27-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status === "FAILED") {
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "MAGNIFIC_FAILED",
        upstreamErrorMessage: data.error_message ?? null,
      });
      return;
    }
    if (data.status !== "COMPLETED") return;

    const sourceUrl = data.generated[0];
    if (!sourceUrl) {
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "COMPLETED_WITHOUT_URL",
      });
      return;
    }

    const [existing] = await db
      .select({ videoUrl: usageLogs.videoUrl })
      .from(usageLogs)
      .where(eq(usageLogs.freepikTaskId, taskId))
      .limit(1);

    if (existing?.videoUrl) {
      data.generated[0] = existing.videoUrl;
      return;
    }

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
  },
});
