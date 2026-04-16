/**
 * Pure function: maps form values → Kling V3 API params.
 * Strips empty strings, trims whitespace, and maps fields correctly.
 */

import type { KlingV3GenerateParams } from "@/lib/freepik/types";
import type { GeneratorFormValues } from "./generator-schema";

export function toApiParams(v: GeneratorFormValues): KlingV3GenerateParams {
  const params: KlingV3GenerateParams = {
    aspect_ratio: v.aspect_ratio,
    duration: v.duration,
    cfg_scale: v.cfg_scale,
    generate_audio: v.generate_audio,
  };

  // Prompt
  const prompt = v.prompt?.trim();
  if (prompt) params.prompt = prompt;

  // Negative prompt
  const neg = v.negative_prompt?.trim();
  if (neg) params.negative_prompt = neg;

  // Image URLs (I2V mode)
  if (v.start_image_url?.trim()) {
    params.start_image_url = v.start_image_url.trim();
  }
  if (v.end_image_url?.trim()) {
    params.end_image_url = v.end_image_url.trim();
  }

  // Multi-shot
  if (v.multi_shot && v.multi_prompt && v.multi_prompt.length > 0) {
    params.multi_shot = true;
    params.shot_type = v.shot_type;
    params.multi_prompt = v.multi_prompt
      .filter((s) => s.prompt?.trim() || s.duration)
      .map((s) => ({
        prompt: s.prompt?.trim() || undefined,
        duration: s.duration,
      }));
  }

  // Elements
  if (v.elements && v.elements.length > 0) {
    const filtered = v.elements.filter(
      (e) => e.frontal_image_url?.trim() || (e.reference_image_urls && e.reference_image_urls.length > 0)
    );
    if (filtered.length > 0) {
      params.elements = filtered.map((e) => ({
        frontal_image_url: e.frontal_image_url?.trim() || undefined,
        reference_image_urls: e.reference_image_urls?.filter((u) => u.trim()) ?? [],
      }));
    }
  }

  return params;
}

/**
 * Override start_image_url for a single batch item
 * (used when generating from a batch with per-image prompts).
 */
export function toBatchApiParams(
  v: GeneratorFormValues,
  imageUrl: string,
  prompt?: string
): KlingV3GenerateParams {
  const params = toApiParams({ ...v, mode: "i2v", start_image_url: imageUrl });
  if (prompt?.trim()) {
    params.prompt = prompt.trim();
  }
  return params;
}
