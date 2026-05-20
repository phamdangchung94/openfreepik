/** Zod schemas for Kling Motion Control request validation. */

import { z } from "zod";

export const klingMotionVersionSchema = z.enum(["v2-6", "v3"]);
export const klingMotionTierSchema = z.enum(["std", "pro"]);
export const klingMotionOrientationSchema = z.enum(["video", "image"]);

/**
 * Magnific's request shape — character image + reference motion video.
 * No explicit `duration` field; output length is controlled indirectly
 * by `character_orientation` (video=30s max, image=10s max).
 *
 * For pricing purposes the client passes an additional `output_duration`
 * field (1-30s, defaults to 5) which we use to compute cost; it doesn't
 * go upstream to Magnific.
 */
export const klingMotionGenerateParamsSchema = z.object({
  image_url: z.string().url(),
  video_url: z.string().url(),
  prompt: z.string().max(2500).optional(),
  character_orientation: klingMotionOrientationSchema.optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  webhook_url: z.string().url().optional(),
});

/**
 * The route input — params + tier metadata. Tier comes from the URL
 * dynamic segment (`[tier]`), version is derived from same. We also
 * accept `output_duration` here for pricing because Magnific bills by
 * delivered seconds (5 / 10 / 15 / 30) even though the API has no
 * matching request param.
 */
export const klingMotionRouteInputSchema = z.object({
  params: klingMotionGenerateParamsSchema,
  /**
   * Billed output duration in seconds (integer). Customer is charged
   * `ceil(reference_video_duration)` × per-second rate, clamped by
   * orientation cap (30s video / 10s image). The route handler
   * enforces the cap against `character_orientation`.
   */
  output_duration: z.number().int().min(1).max(30),
});

export type KlingMotionRouteInput = z.infer<typeof klingMotionRouteInputSchema>;

/**
 * Parse the URL `[tier]` segment into a (version, tier) tuple.
 * Returns null for unknown values so the route can 404 cleanly.
 */
export function parseTierParam(
  raw: string,
): { version: "v2-6" | "v3"; tier: "std" | "pro" } | null {
  switch (raw) {
    case "v2-6-std":
      return { version: "v2-6", tier: "std" };
    case "v2-6-pro":
      return { version: "v2-6", tier: "pro" };
    case "v3-std":
      return { version: "v3", tier: "std" };
    case "v3-pro":
      return { version: "v3", tier: "pro" };
    default:
      return null;
  }
}

/**
 * Validate output_duration against character_orientation.
 *   - "video" allows 1-30s
 *   - "image" allows 1-10s
 * Returns null if valid, error message if not.
 */
export function validateOutputDuration(
  durationSeconds: number,
  orientation: "video" | "image" | undefined,
): string | null {
  const max = orientation === "image" ? 10 : 30;
  if (durationSeconds < 1 || durationSeconds > max) {
    return `output_duration must be 1-${max}s for character_orientation=${orientation ?? "video"}`;
  }
  return null;
}
