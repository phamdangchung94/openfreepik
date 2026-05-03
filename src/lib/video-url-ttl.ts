/**
 * Conservative TTL for the Freepik-issued video URL. Freepik doesn't
 * publish an official lifetime; 24h matches the AWS CloudFront signed-URL
 * default and the figure shown to customers in the auto-download dialog.
 *
 * Used by:
 *   - the server poll endpoint when persisting a freshly-completed video
 *   - the client when a poll returns COMPLETED before the server has had
 *     a chance to record it (best-effort optimistic value).
 *
 * The server is the source of truth — once /api/usage hydrates, the
 * stored timestamp wins.
 */
export const VIDEO_URL_TTL_HOURS = 24;
export const VIDEO_URL_TTL_MS = VIDEO_URL_TTL_HOURS * 60 * 60 * 1000;

/** Optimistic client-side expiry for a just-COMPLETED poll result. */
export function expiresFromNow(): number {
  return Date.now() + VIDEO_URL_TTL_MS;
}
