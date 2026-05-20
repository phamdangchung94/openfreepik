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

/**
 * Kling Motion Control allowed output durations (seconds). Magnific
 * caps orientation=image at 10s; orientation=video at 30s. superRefine
 * enforces the per-orientation cap.
 */
// Per-second billing with ceiling rounding — output_duration is an
// integer 1..30, no longer a tier-snap enum. Auto-derived from
// motion_video_duration by motion-output-duration-picker.
const MOTION_DURATION = z.number().int().min(1).max(30);

export const generatorFormSchema = z
  .object({
    /**
     * Which upstream video model to use.
     *   - "kling-v3"     — text/image → video, 3 tiers (4K / 1080p Pro / 720p Std)
     *   - "wan-v27"      — image → video, separate resolution picker
     *                      (currently hidden from UI — model-picker
     *                      doesn't list it; keep schema value so any
     *                      stored form values stay valid for revert)
     *   - "kling-motion" — character image + reference motion video,
     *                      4 tier combos (2.6/3.0 × Std/Pro)
     */
    model: z.enum(["kling-v3", "wan-v27", "kling-motion"]).default("kling-v3"),
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
    // --- Kling Motion Control fields (only used when model="kling-motion") ---
    /** Flat tier picker: 4 button options. */
    motion_tier: z
      .enum(["v2-6-std", "v2-6-pro", "v3-std", "v3-pro"])
      .default("v2-6-std"),
    /**
     * "video" (default) caps output at 30s, follows reference motion
     * fidelity. "image" caps at 10s, better for camera-following shots.
     */
    motion_orientation: z.enum(["video", "image"]).default("video"),
    /** Public URL of the reference motion video (litterbox). */
    motion_video_url: z.string().default(""),
    /**
     * Detected duration of the uploaded reference video (seconds).
     * Set client-side by motion-video-picker after the <video>
     * metadata loads. Drives auto-mapping to output_duration tier.
     * Null/0 until upload completes.
     */
    motion_video_duration: z.number().default(0),
    /**
     * Output duration tier — 5/10/15/30. Auto-derived from
     * `motion_video_duration` (ceiling to the nearest tier, capped
     * by `motion_orientation`). Customer doesn't pick this manually
     * any more; the form just shows it as a readonly badge after
     * video upload.
     */
    output_duration: MOTION_DURATION.default(5),
  })
  .superRefine((data, ctx) => {
    // Kling Motion — needs both character image + reference video,
    // plus output_duration cap depends on orientation.
    if (data.model === "kling-motion") {
      if (!data.start_image_url.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cần ảnh nhân vật (character image).",
          path: ["start_image_url"],
        });
      }
      if (!data.motion_video_url.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cần video tham chiếu motion (3-30s).",
          path: ["motion_video_url"],
        });
      }
      // output_duration is auto-derived from motion_video_duration +
      // orientation cap (see motion-output-duration-picker.tsx). The
      // route handler still enforces the cap server-side as defence
      // against a malicious direct POST.
      return;
    }

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
