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
}

/**
 * Filename pattern: `{slug15}_kling-{tier}_{date}.mp4`
 *
 * Example: "ABC123 cinematic shot of a cat" →
 *          "abc123-cinemati_kling-pro_20260504-1430.mp4"
 *
 * The 15-char prompt slug at the FRONT means customers who put a
 * tracking code at the start of the prompt (e.g. "ABC123 do this video")
 * can sort or grep their Downloads folder by that code. Underscores
 * separate the prompt-derived part from the system-generated metadata
 * so the visual boundary is unambiguous even when the slug ends in `-`.
 */
export function buildFilename(opts: FilenameInputs): string {
  const d = new Date(opts.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  // 15 chars is enough for a typical "ABC123 + 8 chars description" code
  // prefix. Strip diacritics first so Vietnamese prompts produce ASCII
  // filenames the OS won't mangle.
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
