/** Zod schemas for WAN 2.7 image-to-video request validation. */

import { z } from "zod";

export const wanV27ResolutionSchema = z.enum(["720P", "1080P"]);

const wanV27AdditionalSettingsSchema = z.object({
  prompt_extend: z.boolean().optional(),
});

/**
 * WAN 2.7 has three input modes:
 *   1. First-frame only          (start_image_url)
 *   2. First + last frame        (start_image_url + end_image_url)
 *   3. Video continuation        (video_url, ± end_image_url)
 *
 * The .refine() at the bottom rejects payloads that violate the
 * mutual-exclusivity rule (start_image_url XOR video_url required).
 */
export const wanV27GenerateParamsSchema = z
  .object({
    prompt: z.string().max(5000).optional(),
    negative_prompt: z.string().max(500).optional(),
    start_image_url: z.string().url().optional(),
    end_image_url: z.string().url().optional(),
    audio_url: z.string().url().optional(),
    video_url: z.string().url().optional(),
    resolution: wanV27ResolutionSchema.optional(),
    duration: z.number().int().min(2).max(15).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    additional_settings: wanV27AdditionalSettingsSchema.optional(),
    webhook_url: z.string().url().optional(),
  })
  .refine(
    (v) => Boolean(v.start_image_url) || Boolean(v.video_url),
    {
      message:
        "Cần có start_image_url (mode first-frame / first+last) hoặc video_url (mode video continuation).",
      path: ["start_image_url"],
    },
  );

/** Schema for the POST route input. WAN 2.7 doesn't have tiers like Kling. */
export const wanV27RouteInputSchema = z.object({
  params: wanV27GenerateParamsSchema,
});

export type WanV27RouteInput = z.infer<typeof wanV27RouteInputSchema>;
