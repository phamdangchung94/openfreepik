/**
 * Zod schema for the generator form.
 * Uses a flat schema with superRefine for cross-field validation
 * (discriminatedUnion has compat issues with hookform resolvers in zod 4).
 */

import { z } from "zod/v4";

/**
 * Allowed values across BOTH models — duration "2" is WAN-only,
 * "3"–"15" overlap. Pricing lookup will reject incompatible combos
 * (e.g. Kling + 2s) before charging.
 */
const DURATION_ENUM = z.enum([
  "2", "3", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "13", "14", "15",
]);

export const generatorFormSchema = z
  .object({
    /**
     * Which upstream video model to use. Kling 3 covers all three
     * quality tiers (4K / 1080p Pro / 720p Std); WAN 2.7 is a
     * separate image-only model with its own resolution picker.
     */
    model: z.enum(["kling-v3", "wan-v27"]).default("kling-v3"),
    mode: z.enum(["t2v", "i2v"]),
    prompt: z.string().default(""),
    negative_prompt: z.string().max(2500).default("blur, distort, and low quality"),
    start_image_url: z.string().default(""),
    end_image_url: z.string().default(""),
    /**
     * Kling 3 quality tier. '4k' routes to the kling-4k-* Magnific
     * endpoints (no multi-shot, no elements); 'pro' and 'std' route
     * to kling-v3-{pro,std}.
     */
    tier: z.enum(["pro", "std", "4k"]).default("pro"),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    /** WAN-only: 720P / 1080P. Ignored when model="kling-v3". */
    resolution: z.enum(["720P", "1080P"]).default("1080P"),
    duration: DURATION_ENUM.default("5"),
    cfg_scale: z.number().min(0).max(1).default(0.5),
    generate_audio: z.boolean().default(true),
    multi_shot: z.boolean().default(false),
    shot_type: z.enum(["customize", "intelligent"]).default("customize"),
    multi_prompt: z
      .array(
        z.object({
          prompt: z.string().max(2500).default(""),
          duration: DURATION_ENUM.default("5"),
        })
      )
      .max(6)
      .default([]),
    elements: z
      .array(
        z.object({
          frontal_image_url: z.string().default(""),
          reference_image_urls: z.array(z.string()).default([]),
        })
      )
      .default([]),
    webhook_url: z.string().default(""),
  })
  .superRefine((data, ctx) => {
    // WAN 2.7 is image-to-video only — no prompt-only path. Force i2v
    // and require a start image.
    if (data.model === "wan-v27") {
      if (!data.start_image_url.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WAN 2.7 yêu cầu ảnh đầu (start image).",
          path: ["start_image_url"],
        });
      }
      return;
    }

    if (data.mode === "t2v" && !data.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt is required for Text-to-Video",
        path: ["prompt"],
      });
    }
    if (data.mode === "i2v" && !data.start_image_url.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start image is required for Image-to-Video",
        path: ["start_image_url"],
      });
    }
  });

export type GeneratorFormValues = z.infer<typeof generatorFormSchema>;

/** Batch item — one prompt-driven generation, image-bound for I2V or text-only for T2V. */
export interface BatchItem {
  id: string;
  mode: "t2v" | "i2v";
  prompt: string;
  /** Required for i2v mode; undefined for t2v. */
  imageUrl?: string;
  /** Browser preview data URI — i2v only. */
  previewUrl?: string;
  filename?: string;
  file?: File;
}
