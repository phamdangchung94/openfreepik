/**
 * Allowlist for media URLs rendered in <img>/<video> tags. Filters out
 * `javascript:`, `data:`-with-script-payload, and arbitrary attacker
 * origins so an XSS via injected URL can't fire.
 *
 * Allowed:
 *   - data: URIs (only image/* mimetypes — used for upload previews)
 *   - blob: URIs (used for transient browser-side previews)
 *   - https://*.freepik.com (Freepik CDN)
 *   - https://litterbox.catbox.moe (our upload host)
 *
 * Anything else returns null and the caller should render a fallback.
 */

const ALLOWED_HOSTS = ["freepik.com", "litterbox.catbox.moe"] as const;

export function safeMediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // data:image/*  — OK for in-browser previews (upload thumbnail)
  if (trimmed.startsWith("data:image/")) return trimmed;

  // blob: — OK, browser-only object URLs
  if (trimmed.startsWith("blob:")) return trimmed;

  // Anything that's not http(s) is rejected (javascript:, vbscript:, etc.)
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  // Match host against allowlist (suffix match, e.g. cdn.freepik.com → freepik.com)
  const hostOk = ALLOWED_HOSTS.some(
    (allowed) =>
      url.hostname === allowed || url.hostname.endsWith("." + allowed),
  );
  if (!hostOk) return null;

  return trimmed;
}
