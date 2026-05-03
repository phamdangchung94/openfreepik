import { and, eq, isNull } from "drizzle-orm";
import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";

/**
 * GET /api/freepik/kling-v3/[taskId]
 * Header: Authorization: Bearer <activation-code>
 * Returns: { data: TaskData }
 *
 * On the first poll that comes back COMPLETED, write the resulting video
 * URL into usage_logs so the admin/customer history pages can deep-link
 * to it. Idempotent — only fills in rows where video_url is still null.
 */
export const GET = createTaskGetHandler(freepik.klingV3.getTask, {
  onSuccess: async (taskId, data) => {
    if (data.status !== "COMPLETED") return;
    const videoUrl = data.generated[0];
    if (!videoUrl) return;

    await db
      .update(usageLogs)
      .set({ videoUrl })
      .where(
        and(
          eq(usageLogs.freepikTaskId, taskId),
          isNull(usageLogs.videoUrl),
        ),
      );
  },
});
