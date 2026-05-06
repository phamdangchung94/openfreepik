/**
 * Allowlist for media URLs rendered in <img>/<video> tags. Filters out
 * `javascript:`, `data:`-with-script-payload, and arbitrary attacker
 * origins so an XSS via injected URL can't fire.
 *
 * Allowed:
 *   - data: URIs (only image/* mimetypes — used for upload previews)
 *   - blob: URIs (used for transient browser-side previews)
 *   - https://*.freepik.com         (Magnific/Freepik original CDN)
 *   - https://*.magnific.com        (alt host post-rebrand)
 *   - https://litterbox.catbox.moe  (upload host fallback)
 *   - https://tmpfiles.org          (upload host primary)
 *   - https://*.r2.dev              (Cloudflare R2 mirrored videos)
 *   - https://*.r2.cloudflarestorage.com (R2 raw bucket URL)
 *   - NEXT_PUBLIC_R2_PUBLIC_URL_BASE host (project-specific R2 domain)
 *
 * Anything else returns null and the caller should render a fallback.
 */

// Suffix-matched hosts. Hostnames either equal or end with `.<host>`.
const ALLOWED_HOSTS = [
  "freepik.com",
  "magnific.com",
  "litterbox.catbox.moe",
  "tmpfiles.org",
  "r2.dev",
  "r2.cloudflarestorage.com",
] as const;

/**
 * Optional client-exposed R2 base URL — when set, its host is
 * appended to the allowlist. Project-specific (e.g.
 * "https://pub-81ac6059326648a489697b3c4ada49d8.r2.dev"). Falls back
 * to the wildcard *.r2.dev rule above when not provided.
 */
function extraR2Host(): string | null {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL_BASE;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

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

  // Suffix match against the static allowlist.
  const hostOk = ALLOWED_HOSTS.some(
    (allowed) =>
      url.hostname === allowed || url.hostname.endsWith("." + allowed),
  );
  if (hostOk) return trimmed;

  // Project-specific R2 host (exact match — env-driven).
  const extra = extraR2Host();
  if (extra && url.hostname === extra) return trimmed;

  return null;
}
