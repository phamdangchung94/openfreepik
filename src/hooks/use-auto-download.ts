"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import { usePreferencesStore } from "@/store/preferences-store";
import { buildFilename, downloadVideo } from "@/lib/auto-download";
import { isMobileDevice } from "@/lib/is-mobile";

/**
 * Smart auto-download: differentiate single-video vs batch flow.
 *
 *   - Single video (no batch in flight): fire the download immediately,
 *     mark downloadedAt, success toast.
 *   - Batch (≥ 2 tasks active when one completes): accumulate the IDs.
 *     When the queue drains, surface a single toast with a "Tải tất cả"
 *     action so the customer chooses when the browser flood happens.
 *
 * Mobile (touch-primary): auto-download is unreliable on iOS Safari and
 * inconsistent on Android Chrome. The toggle is hidden in the header on
 * those devices, but if it somehow ends up enabled (synced from desktop)
 * we still skip — manual download from history works.
 *
 * Idempotency: triggered tracks task IDs already triggered this session,
 * both for instant-fire and toast-deferred paths.
 */

// Module-level state — there's only ever one auto-download watcher per
// app, and the deferred batch toast needs to outlive the React effect
// closure (toast can be clicked many seconds after the queue drained).
const triggered = new Set<string>();
const pendingBatch = new Set<string>();

export function useAutoDownload() {
  useEffect(() => {
    if (isMobileDevice()) return; // Mobile bail — see header notes above

    // Pre-seed: tasks already COMPLETED at mount aren't "new" — don't
    // download them. (Customer can still manual-download from history.)
    const initial = useTaskStore.getState().tasks;
    for (const [id, task] of Object.entries(initial)) {
      if (task.status === "COMPLETED") triggered.add(id);
    }

    const unsub = useTaskStore.subscribe((state, prev) => {
      if (!usePreferencesStore.getState().autoDownload) return;

      // Are we currently mid-batch? "Mid-batch" = the queue still has
      // items OR we're currently processing. The transition that flushes
      // the deferred batch is detected separately below.
      const inBatch = state.queue.length > 0 || state.isProcessing;

      // ── 1. Detect newly-completed tasks ────────────────────────────
      for (const [id, task] of Object.entries(state.tasks)) {
        if (task.status !== "COMPLETED" || !task.videoUrl) continue;
        if (triggered.has(id)) continue;
        const prevTask = prev.tasks[id];
        if (prevTask?.status === "COMPLETED") {
          // Was already complete before this update — pre-seed missed it.
          triggered.add(id);
          continue;
        }

        triggered.add(id);

        if (inBatch) {
          // Defer — flush via toast when batch drains. Avoids the browser
          // "Allow multiple downloads?" prompt on the 2nd file.
          pendingBatch.add(id);
        } else {
          fireSingleDownload(id, task);
        }
      }

      // ── 2. Batch just finished → flush deferred toast ──────────────
      const wasBatch = prev.isProcessing || prev.queue.length > 0;
      const nowIdle = !state.isProcessing && state.queue.length === 0;
      if (wasBatch && nowIdle && pendingBatch.size > 0) {
        flushBatchToast();
      }
    });

    return unsub;
  }, []);
}

async function fireSingleDownload(id: string, task: GenerationTask) {
  if (!task.videoUrl || !task.taskId) return;

  // Block if URL is already past expiry — saves the user a confusing
  // 404-when-they-open-the-file experience.
  if (task.videoUrlExpiresAt && task.videoUrlExpiresAt < Date.now()) {
    toast.error("Link đã hết hạn — không thể tải");
    return;
  }

  const filename = buildFilename({
    tier: task.tier,
    prompt: task.prompt,
    createdAt: task.createdAt,
  });

  const loading = toast.loading(`Đang tải ${filename}...`);
  const result = await downloadVideo({
    freepikTaskId: task.taskId,
    filename,
  });
  toast.dismiss(loading);

  if (result.ok) {
    useTaskStore.getState().markDownloaded(id);
    toast.success(`Đã tải ${filename}`);
  } else {
    toast.error(downloadErrorToast(result.error));
  }
}

function flushBatchToast() {
  const ids = [...pendingBatch];
  pendingBatch.clear();

  toast(`${ids.length} video đã xong`, {
    description: "Bấm để tải tất cả về máy",
    duration: 30_000,
    action: {
      label: "Tải tất cả",
      onClick: () => downloadBatch(ids),
    },
  });
}

async function downloadBatch(ids: string[]) {
  const tasks = useTaskStore.getState().tasks;
  const mark = useTaskStore.getState().markDownloaded;
  let fired = 0;
  let failed = 0;

  const loading = toast.loading(`Đang tải 0/${ids.length} video...`);

  // Sequential to be gentle on Vercel function concurrency + the user's
  // bandwidth. Typical 20MB video ≈ 1-3s through the proxy, so 10 videos
  // takes 10-30s overall — acceptable for a batch flow.
  for (const id of ids) {
    const t = tasks[id];
    if (!t?.videoUrl || !t.taskId) continue;
    if (t.videoUrlExpiresAt && t.videoUrlExpiresAt < Date.now()) continue;

    toast.loading(`Đang tải ${fired + 1}/${ids.length} video...`, { id: loading });
    const result = await downloadVideo({
      freepikTaskId: t.taskId,
      filename: buildFilename({
        tier: t.tier,
        prompt: t.prompt,
        createdAt: t.createdAt,
      }),
    });
    if (result.ok) {
      mark(id);
      fired++;
    } else {
      failed++;
    }
  }

  toast.dismiss(loading);
  if (fired === 0) {
    toast.error("Không tải được video nào — link có thể đã hết hạn");
  } else if (failed > 0) {
    toast.warning(`Đã tải ${fired} video; ${failed} video thất bại`);
  } else {
    toast.success(`Đã tải ${fired} video`);
  }
}

function downloadErrorToast(
  err: "no_task_id" | "expired" | "auth" | "network" | "upstream",
): string {
  switch (err) {
    case "expired":
      return "Link đã hết hạn — không thể tải";
    case "auth":
      return "Mã kích hoạt hết hạn — vui lòng đăng nhập lại";
    case "network":
      return "Lỗi mạng — kiểm tra kết nối và thử lại";
    case "upstream":
      return "Freepik không trả về video — thử lại sau";
    case "no_task_id":
      return "Video chưa hoàn tất — không thể tải";
  }
}
