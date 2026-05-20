/**
 * Kling Motion Control API client — character image + reference motion
 * video → output video of the character performing that motion.
 *
 * Four endpoints, one shared request shape. The (version, tier) tuple
 * picks the endpoint URL via ENDPOINT_MAP. All four return the
 * standard TaskData (task_id → poll until COMPLETED).
 *
 * Pricing (seeded into `pricing_rules`, retail = base + 10% markup):
 *   v2-6-std: 0.1386 EUR/s   v2-6-pro: 0.2761 EUR/s
 *   v3-std:   0.2948 EUR/s   v3-pro:   0.3938 EUR/s
 *
 * Output duration cap:
 *   character_orientation="video" (default) → 30s max
 *   character_orientation="image"           → 10s max
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  KlingMotionGenerateParams,
  KlingMotionTier,
  KlingMotionVersion,
  TaskData,
} from "./types";

type EndpointKey = `${KlingMotionVersion}:${KlingMotionTier}`;

/**
 * Magnific routes POST per-tier. GET path is inconsistent between
 * versions (confirmed via docs.magnific.com 2026-05-20):
 *
 *   v2-6 GET: /v1/ai/image-to-video/kling-v2-6/{taskId}
 *             (single shared endpoint for both std/pro, different
 *             namespace than POST — image-to-video vs video)
 *   v3   GET: /v1/ai/video/kling-v3-motion-control-{tier}/{taskId}
 *             (per-tier, same shape as POST minus the {taskId})
 *
 * If Magnific unifies this in the future, simplify GET_PATH_MAP to
 * one helper. For now the per-key table makes the divergence explicit.
 */
const POST_ENDPOINT_MAP: Record<EndpointKey, string> = {
  "v2-6:std": "/v1/ai/video/kling-v2-6-motion-control-std",
  "v2-6:pro": "/v1/ai/video/kling-v2-6-motion-control-pro",
  "v3:std": "/v1/ai/video/kling-v3-motion-control-std",
  "v3:pro": "/v1/ai/video/kling-v3-motion-control-pro",
};

const GET_BASE_MAP: Record<EndpointKey, string> = {
  "v2-6:std": "/v1/ai/image-to-video/kling-v2-6",
  "v2-6:pro": "/v1/ai/image-to-video/kling-v2-6",
  "v3:std": "/v1/ai/video/kling-v3-motion-control-std",
  "v3:pro": "/v1/ai/video/kling-v3-motion-control-pro",
};

/**
 * Resolve the Magnific POST endpoint URL for a (version, tier) tuple.
 * Throws if the combination is unknown — that's a programmer error,
 * not a runtime one, so don't bother coercing into a typed Result.
 */
function postEndpointFor(version: KlingMotionVersion, tier: KlingMotionTier): string {
  const key: EndpointKey = `${version}:${tier}`;
  const url = POST_ENDPOINT_MAP[key];
  if (!url) {
    throw new Error(`Unknown kling-motion endpoint: ${key}`);
  }
  return url;
}

function getEndpointBase(version: KlingMotionVersion, tier: KlingMotionTier): string {
  const key: EndpointKey = `${version}:${tier}`;
  const url = GET_BASE_MAP[key];
  if (!url) {
    throw new Error(`Unknown kling-motion endpoint: ${key}`);
  }
  return url;
}

export interface KlingMotionRouteOpts {
  version: KlingMotionVersion;
  tier: KlingMotionTier;
  apiKey: string;
}

export async function generate(
  params: KlingMotionGenerateParams,
  opts: KlingMotionRouteOpts,
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path: postEndpointFor(opts.version, opts.tier),
    body: params,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function getTask(
  taskId: string,
  opts: KlingMotionRouteOpts,
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${getEndpointBase(opts.version, opts.tier)}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}

/**
 * Pricing/admin/analytics helper — flattens (version, tier) into a
 * single string that's reused as the `endpoint` text field in
 * usage_logs + pricing_rules. Keeps the rest of the codebase
 * version-tier agnostic.
 */
export function endpointSlug(
  version: KlingMotionVersion,
  tier: KlingMotionTier,
): `kling-motion-${KlingMotionVersion}-${KlingMotionTier}` {
  return `kling-motion-${version}-${tier}`;
}

/**
 * Inverse of endpointSlug — parses a slug back into (version, tier).
 * Returns null for unrecognised slugs so callers can default-handle.
 * Used by display labels in admin usage table + pricing page.
 */
export function parseEndpointSlug(
  slug: string,
): { version: KlingMotionVersion; tier: KlingMotionTier } | null {
  const m = slug.match(/^kling-motion-(v2-6|v3)-(std|pro)$/);
  if (!m) return null;
  return {
    version: m[1] as KlingMotionVersion,
    tier: m[2] as KlingMotionTier,
  };
}
