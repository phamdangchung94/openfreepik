"use client";

/**
 * Browser-side video download helpers.
 *
 * Why we proxy through our own /api/download instead of pointing an
 * <a download> at the Freepik URL: the `download` attribute is ignored
 * cross-origin, so the browser just plays the video inline in a new tab.
 * The proxy responds with `Content-Disposition: attachment` from our
 * own origin, which forces the browser's save-to-disk flow.
 *
 * Trade-off: doubles bandwidth (Freepik → Vercel → user). Acceptable
 * while we're on Hobby tier — typical 20MB videos × 100/day = 2GB/day,
 * comfortably within the 100GB/month limit.
 */

import { getApiHeaders } from "@/lib/api-headers";

export interface DownloadInputs {
  /** The Freepik task_id stored in the task — what /api/download[taskId] expects. */
  freepikTaskId: string | null;
  /**
   * Optional fallback URL the server uses when the DB row has no
   * video_url (e.g. tasks completed before the schema migration landed).
   * Server enforces a Freepik-host allowlist before accepting it, so
   * the worst a tampered client can achieve is downloading their own
   * Freepik URL.
   */
  videoUrl?: string | null;
  /** Used as the saved filename. */
  filename: string;
}

export type DownloadResult =
  | { ok: true }
  | { ok: false; error: "no_task_id" | "expired" | "auth" | "network" | "upstream" };

/**
 * Fetch the video through our proxy and trigger a save dialog. Returns
 * a result object so callers can show specific toasts (auth lost vs link
 * expired vs network).
 */
export async function downloadVideo(
  inputs: DownloadInputs,
): Promise<DownloadResult> {
  if (typeof document === "undefined") return { ok: false, error: "network" };
  if (!inputs.freepikTaskId) return { ok: false, error: "no_task_id" };

  // Append the localStorage videoUrl as a query param. Server prefers
  // the DB value but falls back to this when the row's video_url is null
  // (existing tasks from before migration 0002 landed have null URL).
  const params = new URLSearchParams();
  if (inputs.videoUrl) params.set("url", inputs.videoUrl);
  const qs = params.toString();
  const route = `/api/download/${inputs.freepikTaskId}${qs ? `?${qs}` : ""}`;

  let res: Response;
  try {
    res = await fetch(route, {
      headers: getApiHeaders(),
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (res.status === 401) return { ok: false, error: "auth" };
  if (res.status === 410) return { ok: false, error: "expired" };
  if (!res.ok) return { ok: false, error: "upstream" };

  // Stream into a blob — for typical 20MB videos this is fine in memory.
  // If we ever ship 100MB+ files we'd switch to streaming-write via the
  // File System Access API (Chrome only).
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = inputs.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke after the click handler has had a chance to start the save.
  // 100ms is plenty for the synthetic anchor click to register; the old
  // 1s window meant a 100-video batch could keep ~2GB of blob bytes alive
  // in memory at the peak. 100ms gets that to ≤200MB.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

  return { ok: true };
}

export interface FilenameInputs {
  tier: "pro" | "std" | "4k";
  prompt: string;
  createdAt: number;
  /**
   * Optional task identifier — last 6 chars used as a uniqueness
   * suffix so batch downloads (100 prompts submitted same minute,
   * similar prompts) don't collide on disk. Pass `task.id` (local
   * UUID) or `task.taskId` (freepik task_id) — both are uniformly
   * distributed UUIDs. Omit for backward compat (old callers); then
   * filename falls back to the legacy minute-precision pattern.
   */
  taskId?: string | null;
}

/**
 * Filename pattern:
 *   With taskId:    `{slug20}_kling-{tier}_{YYYYMMDD-HHMMSS}_{id6}.mp4`
 *   Legacy:         `{slug15}_kling-{tier}_{YYYYMMDD-HHMM}.mp4`
 *
 * Example (batch case, customer submits 100 similar prompts at once):
 *   "Cảnh con mèo nhảy lên bàn ăn ban đêm" →
 *   "canh-con-meo-nhay-len_kling-pro_20260523-143052_a4b9c2.mp4"
 *
 * Design choices (2026-05-23):
 *   - **Slug bumped 15→20 chars** per anh request — more context in
 *     filename so "Cat at sunset 1/2/3..." stays distinguishable
 *   - **Second precision** in timestamp — minute-only collided when
 *     batch dispatched in same minute
 *   - **6-char task_id suffix** — guarantees uniqueness even when
 *     batch dispatches < 1 sec apart with identical prompt prefix.
 *     16^6 ≈ 16M combinations, effectively zero collision risk
 *
 * The 20-char prompt slug at the FRONT means customers who put a
 * tracking code at the start of the prompt (e.g. "ABC123 do this video")
 * can sort or grep their Downloads folder by that code. Underscores
 * separate prompt-derived parts from system-generated metadata so the
 * visual boundary is unambiguous even when the slug ends in `-`.
 */
export function buildFilename(opts: FilenameInputs): string {
  const d = new Date(opts.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (opts.taskId) {
    // New format: 20-char slug + seconds + 6-char id suffix
    const datePart =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const slug = sluggify(opts.prompt, 20);
    // Drop dashes from UUID then take last 6 hex chars — short enough
    // not to bloat the filename, wide enough for guaranteed uniqueness.
    const idSuffix = opts.taskId.replace(/-/g, "").slice(-6);
    return `${slug}_kling-${opts.tier}_${datePart}_${idSuffix}.mp4`;
  }
  // Legacy format (no taskId passed) — preserve old behaviour for
  // back-compat. Minute precision + 15-char slug.
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const slug = sluggify(opts.prompt, 15);
  return `${slug}_kling-${opts.tier}_${datePart}.mp4`;
}

function sluggify(input: string, maxChars: number): string {
  // Strip Unicode combining marks (Vietnamese đ/ô/ế/etc.) so we end up
  // with plain ASCII. NFD splits diacritics into separate code points,
  // then the regex drops anything outside [a-z0-9] after lowercase.
  const ascii = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d");
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxChars) || "video"
  );
}
