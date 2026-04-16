/** Zod schemas for Kling V3 request validation (used by route handlers). */

import { z } from "zod";

export const klingV3TierSchema = z.enum(["pro", "std"]);

const klingV3DurationSchema = z.enum([
  "3", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "13", "14", "15",
]);

const klingV3AspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]);

const klingV3ShotTypeSchema = z.enum(["customize", "intelligent"]);

const klingV3ElementSchema = z.object({
  reference_image_urls: z.array(z.string()).optional(),
  frontal_image_url: z.string().optional(),
});

const klingV3MultiPromptItemSchema = z.object({
  prompt: z.string().max(2500).optional(),
  duration: klingV3DurationSchema.optional(),
});

export const klingV3GenerateParamsSchema = z.object({
  prompt: z.string().max(2500).optional(),
  negative_prompt: z.string().max(2500).optional(),
  start_image_url: z.string().optional(),
  end_image_url: z.string().optional(),
  elements: z.array(klingV3ElementSchema).optional(),
  multi_shot: z.boolean().optional(),
  shot_type: klingV3ShotTypeSchema.optional(),
  multi_prompt: z.array(klingV3MultiPromptItemSchema).max(6).optional(),
  aspect_ratio: klingV3AspectRatioSchema.optional(),
  duration: klingV3DurationSchema.optional(),
  cfg_scale: z.number().min(0).max(1).optional(),
  generate_audio: z.boolean().optional(),
  webhook_url: z.string().url().optional(),
});

/** Schema for the POST route input: params + tier */
export const klingV3RouteInputSchema = z.object({
  params: klingV3GenerateParamsSchema,
  tier: klingV3TierSchema,
});

export type KlingV3RouteInput = z.infer<typeof klingV3RouteInputSchema>;
