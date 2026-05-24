/**
 * Feature flag for deprecated model endpoints (WAN v2.7, Kling Omni).
 *
 * UI has hidden these models since 2026-05-19/22 but the API routes are
 * still callable for backwards-compat with any customer/integration that
 * latched onto them via direct sk_* calls. When the team is confident no
 * one depends on a model anymore, set DISABLE_LEGACY_MODELS to gate it.
 *
 * Env var format: comma-separated slugs, case-insensitive. Examples:
 *   DISABLE_LEGACY_MODELS=wan-v27               # WAN only
 *   DISABLE_LEGACY_MODELS=wan-v27,kling-omni    # WAN + all Omni variants
 *   DISABLE_LEGACY_MODELS=all                   # nuke every legacy slug
 *
 * Default empty → no gate (current production behaviour). Flip in Vercel
 * env when ready; redeploy not required (read at request time so flag
 * changes apply on next cold start).
 *
 * Returns true when the caller should bail with 410 Gone.
 */

const ALL_LEGACY_SLUGS = new Set([
  "wan-v27",
  // Omni shipped in 4 endpoint slugs but the user typically wants
  // all-or-nothing — accept "kling-omni" as a prefix shortcut.
  "kling-omni",
  "kling-omni-std-video",
  "kling-omni-pro-video",
  "kling-omni-std-reference",
  "kling-omni-pro-reference",
]);

/** Pure parser — visible for tests. */
export function parseDisabledSet(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return new Set();
  if (trimmed === "all") return new Set(ALL_LEGACY_SLUGS);
  return new Set(
    trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * True when the given endpoint slug is currently flagged off.
 *
 * Match logic:
 *   - Exact slug match (e.g. "kling-omni-std-video")
 *   - Prefix match against "kling-omni" (covers all 4 variants)
 *   - "all" in DISABLE_LEGACY_MODELS → matches every entry in
 *     ALL_LEGACY_SLUGS
 */
export function isLegacyEndpointDisabled(slug: string): boolean {
  const disabled = parseDisabledSet(process.env.DISABLE_LEGACY_MODELS);
  if (disabled.size === 0) return false;
  const lower = slug.toLowerCase();
  if (disabled.has(lower)) return true;
  // Prefix-shortcut: "kling-omni" covers all 4 omni variants
  if (lower.startsWith("kling-omni-") && disabled.has("kling-omni")) {
    return true;
  }
  return false;
}

/**
 * Pre-baked response body for 410 Gone. Caller does:
 *   if (isLegacyEndpointDisabled("wan-v27")) {
 *     return NextResponse.json(legacyGoneBody("wan-v27"), { status: 410 });
 *   }
 */
export function legacyGoneBody(slug: string, replacement?: string) {
  return {
    ok: false,
    error: "ENDPOINT_DEPRECATED",
    message: replacement
      ? `Model "${slug}" đã ngừng phục vụ. Vui lòng chuyển sang "${replacement}".`
      : `Model "${slug}" đã ngừng phục vụ. Liên hệ hỗ trợ để biết thêm chi tiết.`,
  };
}
