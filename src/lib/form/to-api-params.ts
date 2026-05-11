/**
 * Pure function: maps form values → upstream API params (Kling V3 or
 * WAN 2.7 depending on `v.model`). Strips empty strings, trims
 * whitespace, and maps fields correctly per upstream schema.
 */

import type {
  Kling4kI2vGenerateParams,
  Kling4kT2vGenerateParams,
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

/**
 * Build Kling 4K T2V params from form values. Mirrors the kling-v3
 * T2V shape but omits tier/audio/multi-shot/elements (none supported
 * upstream) and forces duration into the 3–15 enum (no "2").
 */
export function toKling4kT2vParams(v: GeneratorFormValues): Kling4kT2vGenerateParams {
  const params: Kling4kT2vGenerateParams = {
    prompt: v.prompt?.trim() ?? "",
    aspect_ratio: v.aspect_ratio,
    duration: coerceKlingDuration(v.duration),
    cfg_scale: v.cfg_scale,
  };
  const neg = v.negative_prompt?.trim();
  if (neg) params.negative_prompt = neg;
  return params;
}

/**
 * Build Kling 4K I2V params from form values. `image` is required —
 * the form schema's superRefine guarantees start_image_url is set
 * when model=kling-4k AND mode=i2v.
 */
export function toKling4kI2vParams(v: GeneratorFormValues): Kling4kI2vGenerateParams {
  const params: Kling4kI2vGenerateParams = {
    image: v.start_image_url.trim(),
    duration: coerceKlingDuration(v.duration),
    cfg_scale: v.cfg_scale,
  };
  const prompt = v.prompt?.trim();
  if (prompt) params.prompt = prompt;
  const neg = v.negative_prompt?.trim();
  if (neg) params.negative_prompt = neg;
  const tail = v.end_image_url?.trim();
  if (tail) params.image_tail = tail;
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

  // Multi-shot. Two correctness requirements per Magnific docs:
  //
  //   1. shot_type=customize: every shot MUST have a non-empty prompt.
  //      Filter out empty-prompt shots so we don't send blank items
  //      that confuse the segmenter and produce a flat un-prompted
  //      scene. shot_type=intelligent allows missing prompts (auto-
  //      segmented), so we keep all items in that branch.
  //
  //   2. The top-level `prompt` is "Required for text-to-video mode OR
  //      when not using multi_prompt." When multi_prompt IS set,
  //      sending the top-level prompt makes Magnific blend it with the
  //      per-shot prompts and the result loses scene fidelity (this
  //      was the customer-reported "không bám prompt" symptom). Drop
  //      the single prompt when valid multi_prompt items exist.
  if (v.multi_shot && v.multi_prompt && v.multi_prompt.length > 0) {
    const items = v.multi_prompt
      .map((s) => ({
        prompt: s.prompt?.trim() ?? "",
        duration: s.duration,
      }))
      .filter((s) =>
        v.shot_type === "intelligent"
          ? // intelligent mode: shots without prompts are valid hints.
            s.prompt.length > 0 || !!s.duration
          : // customize mode: every shot needs its own prompt.
            s.prompt.length > 0,
      );

    if (items.length > 0) {
      params.multi_shot = true;
      params.shot_type = v.shot_type;
      params.multi_prompt = items.map((s) => ({
        prompt: s.prompt || undefined,
        duration: coerceKlingDuration(s.duration),
      }));
      // Avoid the global-vs-per-shot prompt collision described above.
      delete params.prompt;
      // Replace top-level duration with the SUM of per-shot durations.
      // Customer-reported failure: top-level "15" + shots summing to 14s
      // → Magnific accepts the POST (CREATED) but the generation pipeline
      // marks the task FAILED because the totals don't agree. Recomputing
      // the sum here keeps the two values consistent on every submit so
      // the customer never has to align them by hand. Clamp to the
      // 3–15s enum so toFixed coercions stay valid.
      const shotSum = items.reduce(
        (acc, s) => acc + parseInt(s.duration ?? "0", 10),
        0,
      );
      if (shotSum >= 3 && shotSum <= 15) {
        params.duration = String(shotSum) as KlingV3Duration;
      }
    }
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

/** Kling 4K T2V batch item — override prompt, reuse shared settings. */
export function toBatchKling4kT2vParams(
  v: GeneratorFormValues,
  prompt: string,
): Kling4kT2vGenerateParams {
  return toKling4kT2vParams({ ...v, mode: "t2v", prompt });
}

/** Kling 4K I2V batch item — override per-item image + prompt. */
export function toBatchKling4kI2vParams(
  v: GeneratorFormValues,
  imageUrl: string,
  prompt: string,
): Kling4kI2vGenerateParams {
  return toKling4kI2vParams({
    ...v,
    mode: "i2v",
    start_image_url: imageUrl,
    prompt,
  });
}
