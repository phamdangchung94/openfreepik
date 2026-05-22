/** Zod schemas + tier parsing for Kling 3 Omni route input. */

import { z } from "zod";

export const klingOmniTierSchema = z.enum(["std", "pro"]);
export const klingOmniModeSchema = z.enum(["video", "reference"]);
export const klingOmniAspectRatioSchema = z.enum([
  "auto",
  "16:9",
  "9:16",
  "1:1",
]);
export const klingOmniDurationSchema = z.enum([
  "3", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "13", "14", "15",
]);

const klingOmniElementSchema = z.object({
  frontal_image_url: z.string().url().optional(),
  reference_image_urls: z.array(z.string().url()).max(4).optional(),
});

/**
 * Request body schema. Same shape for both `video` + `reference`
 * namespaces; mode is the URL not a field. Validation enforces
 * mode-specific required fields via superRefine in the route handler
 * (we can't know mode here without coupling schema to URL parsing).
 *
 * Required overall: at least one of `prompt`, `multi_prompt`. Mode
 * checks layered on top.
 */
export const klingOmniGenerateParamsSchema = z.object({
  prompt: z.string().max(2500).optional(),
  multi_prompt: z.array(z.string().min(1).max(2500)).min(1).max(6).optional(),
  shot_type: z.literal("customize").optional(),
  image_url: z.string().url().optional(),
  start_image_url: z.string().url().optional(),
  end_image_url: z.string().url().optional(),
  image_urls: z.array(z.string().url()).max(4).optional(),
  elements: z.array(klingOmniElementSchema).max(6).optional(),
  video_url: z.string().url().optional(),
  generate_audio: z.boolean().optional(),
  aspect_ratio: klingOmniAspectRatioSchema.optional(),
  duration: klingOmniDurationSchema.optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  negative_prompt: z.string().max(2500).optional(),
  webhook_url: z.string().url().optional(),
});

export const klingOmniRouteInputSchema = z.object({
  params: klingOmniGenerateParamsSchema,
});

export type KlingOmniRouteInput = z.infer<typeof klingOmniRouteInputSchema>;

/**
 * Parse the URL [tier] segment into a (mode, tier) tuple.
 *   omni-std        → video std
 *   omni-pro        → video pro
 *   omni-ref-std    → reference std
 *   omni-ref-pro    → reference pro
 * Returns null for unknown values so the route can 404 cleanly.
 */
export function parseTierParam(
  raw: string,
): { mode: "video" | "reference"; tier: "std" | "pro" } | null {
  switch (raw) {
    case "omni-std":
      return { mode: "video", tier: "std" };
    case "omni-pro":
      return { mode: "video", tier: "pro" };
    case "omni-ref-std":
      return { mode: "reference", tier: "std" };
    case "omni-ref-pro":
      return { mode: "reference", tier: "pro" };
    default:
      return null;
  }
}

/**
 * Mode-aware required-field check. Run in route after parsing body.
 *   - video namespace: at least one of prompt/multi_prompt; image_url
 *     optional (drives I2V).
 *   - reference namespace: video_url required; prompt typically uses
 *     @Video1 — we don't enforce that syntax, Magnific does.
 */
export function validateModeFields(
  mode: "video" | "reference",
  params: z.infer<typeof klingOmniGenerateParamsSchema>,
): string | null {
  if (mode === "reference") {
    if (!params.video_url) {
      return "video_url is required for reference-to-video mode.";
    }
  }
  if (mode === "video" && !params.prompt && !params.multi_prompt?.length) {
    return "prompt or multi_prompt is required for video mode.";
  }
  return null;
}
