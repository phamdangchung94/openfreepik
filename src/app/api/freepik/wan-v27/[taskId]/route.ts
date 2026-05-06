import { and, eq, isNull } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import { isR2Configured, mirrorRemoteToR2, r2KeyForVideo } from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/freepik/wan-v27/[taskId]
 * Header: Authorization: Bearer <activation-code>
 * Returns: { data: TaskData }
 *
 * Same R2-mirror lifecycle as kling-v3 poll: on first COMPLETED, save
 * the original URL to magnific_video_url, attempt the R2 mirror, and
 * rewrite data.generated[0] to the R2 URL so the live response carries
 * the mirrored link from the first poll.
 */
export const maxDuration = 60;

export const GET = createTaskGetHandler(freepik.wanV27.getTask, {
  rateLimit: { resource: "wan-v27-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status !== "COMPLETED") return;
    const sourceUrl = data.generated[0];
    if (!sourceUrl) return;

    const [existing] = await db
      .select({
        videoUrl: usageLogs.videoUrl,
        magnificVideoUrl: usageLogs.magnificVideoUrl,
      })
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

    const expiresAt = new Date(Date.now() + VIDEO_URL_TTL_MS);
    await db
      .update(usageLogs)
      .set({
        videoUrl,
        magnificVideoUrl: sourceUrl,
        videoUrlExpiresAt: expiresAt,
      })
      .where(
        and(
          eq(usageLogs.freepikTaskId, taskId),
          isNull(usageLogs.videoUrl),
        ),
      );

    data.generated[0] = videoUrl;
  },
});
