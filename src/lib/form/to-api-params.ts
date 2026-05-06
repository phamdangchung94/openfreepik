/**
 * Pure function: maps form values → upstream API params (Kling V3 or
 * WAN 2.7 depending on `v.model`). Strips empty strings, trims
 * whitespace, and maps fields correctly per upstream schema.
 */

import type {
  KlingV3Duration,
  KlingV3GenerateParams,
  WanV27GenerateParams,
} from "@/lib/freepik/types";
import type { GeneratorFormValues } from "./generator-schema";

/**
 * Kling V3 duration enum is "3"–"15" — the form-wide schema also
 * allows "2" (WAN-only). Coerce to a Kling-safe value when building
 * Kling params so TypeScript stops complaining; if the customer
 * somehow ended up with "2" + Kling, server pricing lookup rejects.
 */
function coerceKlingDuration(d: GeneratorFormValues["duration"]): KlingV3Duration {
  return (d === "2" ? "3" : d) as KlingV3Duration;
}

/**
 * Build WAN 2.7 image-to-video params. WAN uses different shapes than
 * Kling — integer duration, resolution string, no aspect_ratio, no
 * tier, no multi-shot, no audio toggle.
 *
 * Phase 1: only the first-frame mode is wired (start_image_url
 * required). end_image_url, audio_url, video_url are deferred to
 * later phases.
 */
export function toWanParams(v: GeneratorFormValues): WanV27GenerateParams {
  const params: WanV27GenerateParams = {
    resolution: v.resolution,
    // Form schema enforces "2"–"15" so parseInt always succeeds.
    duration: Number(v.duration),
  };
  const prompt = v.prompt?.trim();
  if (prompt) params.prompt = prompt;
  const neg = v.negative_prompt?.trim();
  if (neg) params.negative_prompt = neg;
  if (v.start_image_url?.trim()) {
    params.start_image_url = v.start_image_url.trim();
  }
  return params;
}

export function toApiParams(v: GeneratorFormValues): KlingV3GenerateParams {
  const params: KlingV3GenerateParams = {
    aspect_ratio: v.aspect_ratio,
    duration: coerceKlingDuration(v.duration),
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
        duration: coerceKlingDuration(s.duration),
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
 * Override start_image_url for a single I2V batch item.
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

/**
 * Build params for a single T2V batch item — only the prompt varies
 * per item; everything else (tier, duration, audio, aspect ratio…)
 * comes from the shared form values.
 */
export function toBatchT2VParams(
  v: GeneratorFormValues,
  prompt: string
): KlingV3GenerateParams {
  return toApiParams({
    ...v,
    mode: "t2v",
    prompt,
    start_image_url: "",
    end_image_url: "",
  });
}
