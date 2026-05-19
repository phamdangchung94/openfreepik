"use client";

import { useEffect } from "react";
import { useTaskStore } from "@/store/task-store";

/**
 * Periodically scans the task store and nulls `videoUrl` + `thumbnailUrl`
 * for tasks whose R2 link has passed its TTL. The R2 bucket lifecycle
 * physically deletes the object at the 24h boundary; keeping the dead
 * URL in localStorage means the customer sees a broken `<video>` tag
 * + ugly browser error icon when they revisit.
 *
 * After clearing, the task remains in history (status=COMPLETED) but
 * the preview / thumbnail strip / now-playing bar can render a clean
 * "Video đã hết hạn" message via UI checks on `task.videoUrl === null`.
 *
 * Cadence:
 *   - Runs once on mount (catch any tasks that expired while the tab
 *     was closed)
 *   - Every 5 minutes thereafter (catch tasks crossing the 24h mark
 *     while the tab is open — sub-5-min precision isn't necessary,
 *     R2 deletion lags by hours anyway)
 */
export function useExpiredUrlCleaner() {
  useEffect(() => {
    const clearExpiredUrls = useTaskStore.getState().clearExpiredUrls;
    clearExpiredUrls();
    const interval = setInterval(() => {
      clearExpiredUrls();
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);
}
