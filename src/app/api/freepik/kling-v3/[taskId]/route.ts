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
 * GET /api/freepik/kling-v3/[taskId]
 * Header: Authorization: Bearer <activation-code>
 * Returns: { data: TaskData }
 *
 * Drives the usage_logs lifecycle: rows are inserted as 'pending' by
 * the POST handler and stay pending until this poll observes a
 * terminal Magnific status.
 *
 *   COMPLETED + url → R2 mirror, then status='succeeded'
 *   COMPLETED + no url → status='refunded' + refund
 *   FAILED → status='refunded' + refund
 *
 * Mirror lifecycle: on first success we persist the original Magnific
 * URL into magnific_video_url (permanent record, survives R2 expiry)
 * and try to mirror to R2 (6h lifecycle, faster egress from VN).
 * Mirror failures fall back to the Magnific URL — the customer always
 * gets a working link.
 */

// Next.js 16 App Router: standalone `maxDuration` export, NOT a config
// object. Vercel Pro allows up to 300s on the Fluid runtime.
export const maxDuration = 60;

export const GET = createTaskGetHandler(freepik.klingV3.getTask, {
  // Generous: 60/min = 1/sec sustained, fine for normal 2s polling.
  rateLimit: { resource: "kling-v3-poll", limit: 60, windowSeconds: 60 },
  onSuccess: async (taskId, data) => {
    if (data.status === "FAILED") {
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "MAGNIFIC_FAILED",
      });
      return;
    }
    if (data.status !== "COMPLETED") return;

    const magnificUrl = data.generated[0];
    if (!magnificUrl) {
      // Magnific said COMPLETED but didn't hand us a URL — customer has
      // nothing to download. Treat as failure per the no-link-no-charge
      // contract.
      await finalizeUsageOnPoll({
        freepikTaskId: taskId,
        outcome: "failed",
        failureReason: "COMPLETED_WITHOUT_URL",
      });
      return;
    }

    // Skip the expensive mirror download if a prior poll already
    // persisted the URL. Poll fires every 2s; the first COMPLETED
    // poll wins.
    const [existing] = await db
      .select({ videoUrl: usageLogs.videoUrl })
      .from(usageLogs)
      .where(eq(usageLogs.freepikTaskId, taskId))
      .limit(1);

    if (existing?.videoUrl) {
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
        if (mirroredUrl) videoUrl = mirroredUrl;
      } catch (err) {
        // Don't fail the customer's poll over a mirror error — they
        // still get the Magnific URL and can download for the next 24h.
        log.warn("R2_MIRROR_UNEXPECTED", { taskId, ...errFields(err) });
      }
    }

    await finalizeUsageOnPoll({
      freepikTaskId: taskId,
      outcome: "succeeded",
      videoUrl,
      magnificVideoUrl: magnificUrl,
      videoUrlExpiresAt: new Date(Date.now() + VIDEO_URL_TTL_MS),
    });

    // Rewrite the live response so the client receives the R2 URL on
    // the very first COMPLETED poll, not later via /api/usage.
    data.generated[0] = videoUrl;
  },
});
