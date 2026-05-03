import { and, eq, isNull } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";

/**
 * GET /api/freepik/kling-v3/[taskId]
 * Header: Authorization: Bearer <activation-code>
 * Returns: { data: TaskData }
 *
 * On the first poll that comes back COMPLETED, persist the video URL +
 * its computed expiry into usage_logs so the customer can recover the
 * link from any device while it's still valid. Idempotent — only fills
 * rows where video_url is still null.
 */
export const GET = createTaskGetHandler(freepik.klingV3.getTask, {
  // Generous: 60/min = 1/sec sustained, fine for normal 2s polling.
  rateLimit: { resource: "kling-v3-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status !== "COMPLETED") return;
    const videoUrl = data.generated[0];
    if (!videoUrl) return;

    const videoUrlExpiresAt = new Date(Date.now() + VIDEO_URL_TTL_MS);

    await db
      .update(usageLogs)
      .set({ videoUrl, videoUrlExpiresAt })
      .where(
        and(
          eq(usageLogs.freepikTaskId, taskId),
          isNull(usageLogs.videoUrl),
        ),
      );
  },
});
