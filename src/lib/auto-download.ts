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

  let res: Response;
  try {
    res = await fetch(`/api/download/${inputs.freepikTaskId}`, {
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

  // Revoke after the click handler has had a chance to start the save —
  // Chrome can race if we revoke synchronously.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);

  return { ok: true };
}

export interface FilenameInputs {
  tier: "pro" | "std";
  prompt: string;
  createdAt: number;
}

export function buildFilename(opts: FilenameInputs): string {
  const d = new Date(opts.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const slug =
    opts.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "video";
  return `kling-${opts.tier}-${datePart}-${slug}.mp4`;
}
