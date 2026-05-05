import { and, eq, isNull } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";
import { isR2Configured, mirrorRemoteToR2, r2KeyForVideo } from "@/lib/storage/r2";
import { errFields, log } from "@/lib/logger";

/**
 * GET /api/freepik/kling-v3/[taskId]
 * Header: Authorization: Bearer <activation-code>
 * Returns: { data: TaskData }
 *
 * On the first poll that comes back COMPLETED:
 *   1. Always persist the original Magnific URL into magnific_video_url
 *      (permanent record, survives R2 lifecycle expiry).
 *   2. Try to mirror the video to Cloudflare R2 (6h lifecycle on bucket).
 *      On success, video_url = R2 URL (faster from VN, cheaper egress).
 *      On failure, video_url = Magnific URL (customer always has a link).
 *
 * Idempotent — only fills rows where video_url is still null. The
 * mirror has its own 60s fetch timeout + 60s upload window, fits the
 * Vercel Pro 300s function budget comfortably.
 *
 * Requires Vercel Pro for the maxDuration > 10s (mirror takes 5-15s).
 */
export const config = {
  // Allow time for: poll RTT (~1s) + mirror fetch (~10s) + R2 upload (~5s).
  // Pad to 60s — Pro tier allows up to 300s; this is a comfortable cap.
  maxDuration: 60,
};

export const GET = createTaskGetHandler(freepik.klingV3.getTask, {
  // Generous: 60/min = 1/sec sustained, fine for normal 2s polling.
  rateLimit: { resource: "kling-v3-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status !== "COMPLETED") return;
    const magnificUrl = data.generated[0];
    if (!magnificUrl) return;

    // Try R2 first, fall back to Magnific URL if mirror fails or
    // R2 isn't configured (e.g. local dev without env vars).
    let videoUrl = magnificUrl;
    if (isR2Configured()) {
      try {
        const mirroredUrl = await mirrorRemoteToR2({
          sourceUrl: magnificUrl,
          key: r2KeyForVideo(taskId),
          contentType: "video/mp4",
        });
        if (mirroredUrl) {
          videoUrl = mirroredUrl;
        }
      } catch (err) {
        // Don't fail the customer's poll over a mirror error — they
        // still get the Magnific URL and can download for the next 24h.
        log.warn("R2_MIRROR_UNEXPECTED", {
          taskId,
          ...errFields(err),
        });
      }
    }

    const videoUrlExpiresAt = new Date(Date.now() + VIDEO_URL_TTL_MS);

    await db
      .update(usageLogs)
      .set({
        videoUrl,
        magnificVideoUrl: magnificUrl,
        videoUrlExpiresAt,
      })
      .where(
        and(
          eq(usageLogs.freepikTaskId, taskId),
          isNull(usageLogs.videoUrl),
        ),
      );
  },
});
