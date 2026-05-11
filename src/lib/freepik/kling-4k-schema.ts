/** Zod schemas for Kling 4K T2V + I2V route input validation. */

import { z } from "zod";

const durationSchema = z.enum([
  "3", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "13", "14", "15",
]);

const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);

const dynamicMaskSchema = z.object({
  mask: z.string(),
  trajectories: z
    .array(
      z.object({
        x: z.number().int(),
        y: z.number().int(),
      }),
    )
    .min(1),
});

export const kling4kT2vParamsSchema = z.object({
  prompt: z.string().min(1).max(2500),
  negative_prompt: z.string().max(2500).optional(),
  aspect_ratio: aspectRatioSchema.optional(),
  duration: durationSchema.optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  webhook_url: z.string().url().optional(),
});

export const kling4kI2vParamsSchema = z.object({
  // image is required upstream (URL or Base64). We don't enforce URL
  // shape here because Magnific also accepts Base64 strings.
  image: z.string().min(1),
  image_tail: z.string().optional(),
  prompt: z.string().max(2500).optional(),
  negative_prompt: z.string().max(2500).optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  duration: durationSchema.optional(),
  static_mask: z.string().optional(),
  dynamic_masks: z.array(dynamicMaskSchema).optional(),
  webhook_url: z.string().url().optional(),
});

/** Wrapped shape used by the route handlers (matches kling-v3 pattern). */
export const kling4kT2vRouteInputSchema = z.object({
  params: kling4kT2vParamsSchema,
});
export const kling4kI2vRouteInputSchema = z.object({
  params: kling4kI2vParamsSchema,
});

export type Kling4kT2vRouteInput = z.infer<typeof kling4kT2vRouteInputSchema>;
export type Kling4kI2vRouteInput = z.infer<typeof kling4kI2vRouteInputSchema>;
