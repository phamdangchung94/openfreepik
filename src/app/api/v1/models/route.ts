import { NextResponse } from "next/server";
import { apiSuccess, newRequestId } from "@/lib/api-v1/response";

/**
 * GET /api/v1/models
 *
 * Public catalog of available video models — capabilities + per-second
 * pricing in EUR (customer-facing) + VND (locale-friendly). No auth
 * required so AI tools can discover the catalog without bootstrap.
 *
 * Pricing rates here MUST stay in sync with `pricing_rules` table.
 * Source of truth = DB; this endpoint is a fast curated view. Update
 * both when adding tiers or repricing.
 *
 * Schema versioning: response wraps under `models[]` with `id`,
 * `endpoint`, `capabilities`, `tiers[]`. Adding new fields stays
 * backwards-compatible; renaming requires bumping `version` in the
 * envelope.
 */
export function GET() {
  const requestId = newRequestId();

  return apiSuccess({
    requestId,
    data: {
      ok: true,
      version: "1",
      // Static catalog — keep ordered by approximate quality/cost tier
      // (cheapest first within each family).
      models: [
        {
          id: "kling-3",
          family: "kling",
          endpoint: "POST /v1/video/kling-3",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: ["text-to-video", "image-to-video"],
          aspect_ratios: ["16:9", "9:16", "1:1"],
          durations_seconds: [5, 10],
          supports_audio: true,
          tiers: [
            { id: "std", label: "Kling 3 720p", eur_per_second: 0.018, vnd_per_second: 18 },
            { id: "pro", label: "Kling 3 1080p", eur_per_second: 0.063, vnd_per_second: 63 },
          ],
          notes:
            "Set `tier` in request body (std/pro). With audio = ~1.5× base rate.",
        },
        {
          id: "kling-3-4k-text",
          family: "kling-4k",
          endpoint: "POST /v1/video/kling-3-4k-text",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: ["text-to-video"],
          aspect_ratios: ["16:9", "9:16", "1:1"],
          durations_seconds: [5, 10],
          supports_audio: true,
          tiers: [
            { id: "4k", label: "Kling 3 4K T2V", eur_per_second: 0.252, vnd_per_second: 252 },
          ],
          notes: "4K resolution, T2V only.",
        },
        {
          id: "kling-3-4k-image",
          family: "kling-4k",
          endpoint: "POST /v1/video/kling-3-4k-image",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: ["image-to-video"],
          durations_seconds: [5, 10],
          supports_audio: false,
          tiers: [
            { id: "4k", label: "Kling 3 4K I2V", eur_per_second: 0.252, vnd_per_second: 252 },
          ],
          notes: "4K I2V. Provide image URL or base64 in params.image.",
        },
        {
          id: "kling-motion",
          family: "motion",
          endpoint: "POST /v1/video/kling-motion/{tier}",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: ["character-driven-motion"],
          durations_seconds: [5, 10, 15, 20, 25, 30],
          supports_audio: false,
          tiers: [
            { id: "v2-6-std", label: "Motion 2.6 Std", eur_per_second: 0.059, vnd_per_second: 59 },
            { id: "v2-6-pro", label: "Motion 2.6 Pro", eur_per_second: 0.118, vnd_per_second: 118 },
            { id: "v3-std", label: "Motion 3.0 Std", eur_per_second: 0.126, vnd_per_second: 126 },
            { id: "v3-pro", label: "Motion 3.0 Pro", eur_per_second: 0.168, vnd_per_second: 168 },
          ],
          notes:
            "Requires image_url (character) + video_url (motion reference). " +
            "character_orientation=video supports 5-30s output, =image caps at 10s.",
        },
        {
          id: "kling-omni",
          family: "omni",
          endpoint: "POST /v1/video/kling-omni/{tier}",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: [
            "text-to-video",
            "image-to-video",
            "video-to-video",
            "multi-shot",
            "audio",
            "element-references",
          ],
          aspect_ratios: ["auto", "16:9", "9:16", "1:1"],
          durations_seconds: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          supports_audio: true,
          tiers: [
            { id: "omni-std", label: "Omni Std (T2V/I2V)", eur_per_second: 0.05, vnd_per_second: 50 },
            { id: "omni-pro", label: "Omni Pro (T2V/I2V)", eur_per_second: 0.1, vnd_per_second: 100 },
            { id: "omni-ref-std", label: "Omni Std (V2V)", eur_per_second: 0.05, vnd_per_second: 50 },
            { id: "omni-ref-pro", label: "Omni Pro (V2V)", eur_per_second: 0.1, vnd_per_second: 100 },
          ],
          notes:
            "Supports multi_prompt[] for sequential shots. With generate_audio=true, rate ≈ 1.83× base. " +
            "V2V tiers (omni-ref-*) require video_url. Currently web UI hides these tiers but API remains open.",
        },
        {
          id: "improve-prompt",
          family: "tool",
          endpoint: "POST /v1/prompt/improve",
          poll: "GET /v1/tasks/{task_id}",
          capabilities: ["prompt-enhancement"],
          tiers: [
            { id: "free", label: "Prompt Enhancer", eur_per_second: 0, vnd_per_second: 0 },
          ],
          notes:
            "Free utility. Expands a short prompt into a detailed one. Use type=video for video prompts, type=image for image prompts.",
        },
      ],
      meta: {
        currency_note:
          "Prices in EUR (internal accounting) + VND (~1 EUR = 1000 VND). " +
          "Total cost = ceil(duration_seconds) × rate, with ~1.83× multiplier when audio enabled (Omni) or ~1.5× (Kling 3).",
        billing_note:
          "Charge applied at POST time, refunded automatically on FAILED / TIMEOUT / orphan (15min sweeper).",
      },
    },
    headers: {
      // 5 min cache — catalog rarely changes, AI tools polling /models
      // every request would be wasteful.
      "cache-control": "public, max-age=300",
      // CORS allow-all so browser-side discovery works.
      "access-control-allow-origin": "*",
    },
  });
}

// Handle CORS preflight for /v1/models so SPA tools can fetch it.
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    },
  });
}
