/**
 * Kling 3 Omni API client — multi-modal video generation.
 *
 * 3 input modes share the same body shape; mode is encoded in the URL
 * namespace rather than a body field:
 *   - "video"     namespace: T2V + I2V (no video_url)
 *   - "reference" namespace: V2V (video_url required)
 *
 * Tiers std/pro affect quality (resolution/render time) + pricing.
 *
 * GET poll URL does NOT include tier — single endpoint per namespace
 * serves both std + pro tasks (same pattern as kling-v3).
 *
 * Pricing (retail VND per second, seeded into pricing_rules):
 *   omni-std no-audio: 168 đ/s   with audio: 308 đ/s
 *   omni-pro no-audio: 224 đ/s   with audio: 392 đ/s
 * Same rate across "video" + "reference" namespaces (Magnific list
 * shows single tier price). Admin can adjust per-endpoint if upstream
 * splits the rate later.
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  KlingOmniGenerateParams,
  KlingOmniMode,
  KlingOmniTier,
  TaskData,
} from "./types";

type EndpointKey = `${KlingOmniMode}:${KlingOmniTier}`;

const POST_ENDPOINT_MAP: Record<EndpointKey, string> = {
  "video:std": "/v1/ai/video/kling-v3-omni-std",
  "video:pro": "/v1/ai/video/kling-v3-omni-pro",
  "reference:std": "/v1/ai/reference-to-video/kling-v3-omni-std",
  "reference:pro": "/v1/ai/reference-to-video/kling-v3-omni-pro",
};

const GET_BASE_MAP: Record<KlingOmniMode, string> = {
  video: "/v1/ai/video/kling-v3-omni",
  reference: "/v1/ai/reference-to-video/kling-v3-omni",
};

function postEndpointFor(mode: KlingOmniMode, tier: KlingOmniTier): string {
  const key: EndpointKey = `${mode}:${tier}`;
  const url = POST_ENDPOINT_MAP[key];
  if (!url) throw new Error(`Unknown kling-omni endpoint: ${key}`);
  return url;
}

function getEndpointBase(mode: KlingOmniMode): string {
  const url = GET_BASE_MAP[mode];
  if (!url) throw new Error(`Unknown kling-omni mode: ${mode}`);
  return url;
}

export interface KlingOmniRouteOpts {
  mode: KlingOmniMode;
  tier: KlingOmniTier;
  apiKey: string;
}

export async function generate(
  params: KlingOmniGenerateParams,
  opts: KlingOmniRouteOpts,
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path: postEndpointFor(opts.mode, opts.tier),
    body: params,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function getTask(
  taskId: string,
  opts: Pick<KlingOmniRouteOpts, "mode" | "apiKey">,
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${getEndpointBase(opts.mode)}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}

/**
 * Flatten (mode, tier, audio) into endpoint slug used by pricing_rules +
 * usage_logs.endpoint. Keeps the rest of the codebase mode-tier agnostic.
 *
 * Format: `kling-omni-{tier}-{mode}` (audio is a separate column in
 * pricing_rules, not encoded in the slug).
 */
export function endpointSlug(
  mode: KlingOmniMode,
  tier: KlingOmniTier,
): `kling-omni-${KlingOmniTier}-${KlingOmniMode}` {
  return `kling-omni-${tier}-${mode}`;
}

/**
 * Inverse of endpointSlug — parse a slug back into (mode, tier).
 * Returns null for unrecognised slugs so callers can default-handle.
 */
export function parseEndpointSlug(
  slug: string,
): { mode: KlingOmniMode; tier: KlingOmniTier } | null {
  const m = slug.match(/^kling-omni-(std|pro)-(video|reference)$/);
  if (!m) return null;
  return {
    tier: m[1] as KlingOmniTier,
    mode: m[2] as KlingOmniMode,
  };
}
