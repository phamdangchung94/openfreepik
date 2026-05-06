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
 *   3. Mutate data.generated[0] to the R2 URL before returning so the
 *      live poll response (not just DB hydration) gives the customer
 *      the mirrored URL immediately.
 */

// Next.js 16 App Router: standalone `maxDuration` export, NOT a config
// object. Vercel Pro allows up to 300s on the Fluid runtime.
export const maxDuration = 60;

export const GET = createTaskGetHandler(freepik.klingV3.getTask, {
  // Generous: 60/min = 1/sec sustained, fine for normal 2s polling.
  rateLimit: { resource: "kling-v3-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status !== "COMPLETED") return;
    const magnificUrl = data.generated[0];
    if (!magnificUrl) return;

    // Skip work if we've already persisted this row (poll fires every
    // 2s; the first COMPLETED poll wins, subsequent polls re-fire
    // onSuccess but see video_url already set and short-circuit the
    // expensive mirror download).
    const [existing] = await db
      .select({
        videoUrl: usageLogs.videoUrl,
        magnificVideoUrl: usageLogs.magnificVideoUrl,
      })
      .from(usageLogs)
      .where(eq(usageLogs.freepikTaskId, taskId))
      .limit(1);

    if (existing?.videoUrl) {
      // Already done — make sure the LIVE response uses our stored URL
      // (R2 if mirror succeeded earlier, else Magnific). Mutate in place.
      data.generated[0] = existing.videoUrl;
      return;
    }

    // Try R2 first, fall back to Magnific URL if mirror fails or
    // R2 isn't configured (e.g. local dev without env vars).
    let videoUrl = magnificUrl;
    const r2Enabled = isR2Configured();
    log.info("R2_MIRROR_START", {
      taskId,
      r2Enabled,
      magnificHost: new URL(magnificUrl).host,
    });
    if (r2Enabled) {
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

    // Bug B fix: rewrite the live response so the client receives the
    // R2 URL on the very first COMPLETED poll, not later via /api/usage.
    data.generated[0] = videoUrl;
  },
});
