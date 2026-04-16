/**
 * Zod schema for the generator form.
 * Uses a flat schema with superRefine for cross-field validation
 * (discriminatedUnion has compat issues with hookform resolvers in zod 4).
 */

import { z } from "zod/v4";

export const generatorFormSchema = z
  .object({
    mode: z.enum(["t2v", "i2v"]),
    prompt: z.string().default(""),
    negative_prompt: z.string().max(2500).default("blur, distort, and low quality"),
    start_image_url: z.string().default(""),
    end_image_url: z.string().default(""),
    tier: z.enum(["pro", "std"]).default("pro"),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    duration: z
      .enum(["3","4","5","6","7","8","9","10","11","12","13","14","15"])
      .default("5"),
    cfg_scale: z.number().min(0).max(1).default(0.5),
    generate_audio: z.boolean().default(true),
    multi_shot: z.boolean().default(false),
    shot_type: z.enum(["customize", "intelligent"]).default("customize"),
    multi_prompt: z
      .array(
        z.object({
          prompt: z.string().max(2500).default(""),
          duration: z
            .enum(["3","4","5","6","7","8","9","10","11","12","13","14","15"])
            .default("5"),
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

/** Batch item — one image with its own prompt for I2V batch processing. */
export interface BatchItem {
  id: string;
  file?: File;
  previewUrl: string;
  imageUrl: string;
  prompt: string;
  filename: string;
}
