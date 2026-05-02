"use client";

/**
 * Browser-side video download helpers. Auto-download is opt-in (toggle in the
 * header). When on, every transition to COMPLETED in the task store fires a
 * default-folder download via a temporary anchor click — the browser puts the
 * file in the user's configured Downloads folder.
 *
 * Custom download paths would need the Chrome-only File System Access API and
 * an indexedDB-persisted directory handle; deliberately out of scope for v1.
 */

export function downloadVideo(url: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Without rel=noopener some browsers warn about the synthetic click target.
  a.rel = "noopener";
  // target=_blank is a fallback when the server omits Content-Disposition;
  // the file opens in a new tab the user can save manually.
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
