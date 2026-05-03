/**
 * Extract a best-effort client IP from request headers.
 *
 * Vercel always sets `x-forwarded-for` (the first hop is the real client),
 * but locally and behind some proxies only `x-real-ip` is set. Returns
 * an empty string when neither is present so callers can decide whether
 * to fall back to a different scope (e.g. a session token) or just allow.
 *
 * Note: behind a misconfigured proxy `x-forwarded-for` is forgeable. On
 * Vercel the platform overwrites it, so we trust it; if you self-host
 * behind nginx make sure `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "";
}
