/** Shared types for all Freepik API endpoints. */

export type TaskStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface TaskData {
  task_id: string;
  status: TaskStatus;
  generated: string[];
  /**
   * Upstream-supplied failure reason. Populated on FAILED status only.
   * Field name varies across upstream endpoints — the schema accepts
   * `error`, `reason`, `error_message`, `message`, or `failure_reason`
   * and normalises to this one.
   */
  error_message?: string;
}

export interface FreepikResponse<T = TaskData> {
  data: T;
}

// --------------- Kling V3 ---------------

export type KlingV3Tier = "pro" | "std";

export type KlingV3AspectRatio = "16:9" | "9:16" | "1:1";

export type KlingV3Duration =
  | "3" | "4" | "5" | "6" | "7" | "8"
  | "9" | "10" | "11" | "12" | "13" | "14" | "15";

export type KlingV3ShotType = "customize" | "intelligent";

export interface KlingV3Element {
  reference_image_urls?: string[];
  frontal_image_url?: string;
}

export interface KlingV3MultiPromptItem {
  prompt?: string;
  duration?: KlingV3Duration;
}

export interface KlingV3GenerateParams {
  prompt?: string;
  negative_prompt?: string;
  start_image_url?: string;
  end_image_url?: string;
  elements?: KlingV3Element[];
  multi_shot?: boolean;
  shot_type?: KlingV3ShotType;
  multi_prompt?: KlingV3MultiPromptItem[];
  aspect_ratio?: KlingV3AspectRatio;
  duration?: KlingV3Duration;
  cfg_scale?: number;
  generate_audio?: boolean;
  webhook_url?: string;
}

// --------------- Kling 4K (T2V + I2V) ---------------
//
// Two separate Magnific endpoints with disjoint request shapes:
//   POST /v1/ai/video/kling-4k-t2v — prompt-driven, aspect_ratio supported
//   POST /v1/ai/video/kling-4k-i2v — image-driven, motion-brush masks
// Both share the standard TaskData response shape. Duration enum and
// cfg_scale rules match Kling V3. No tier (single 4K quality SKU). No
// audio parameter — Kling 4K renders silent video.

export type Kling4kAspectRatio = KlingV3AspectRatio;

/** Same enum as Kling V3 — Magnific accepts both string and integer; we
 * keep strings for parity with the V3 schema. */
export type Kling4kDuration = KlingV3Duration;

export interface Kling4kT2vGenerateParams {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: Kling4kAspectRatio;
  duration?: Kling4kDuration;
  cfg_scale?: number;
  /**
   * Magnific's published Kling-4K OpenAPI doesn't list this field, but
   * customers report wanting parity with Kling V3's audio toggle. We
   * forward the flag opportunistically — if Magnific honors it the
   * video has audio, if Magnific ignores it the video is silent (same
   * as without the field). Pricing is the same either way.
   */
  generate_audio?: boolean;
  webhook_url?: string;
}

export interface Kling4kDynamicMask {
  /** Base64 or URL — must match the `image` resolution + aspect ratio. */
  mask: string;
  trajectories: { x: number; y: number }[];
}

export interface Kling4kI2vGenerateParams {
  /** Reference image URL (1:2.5–2.5:1 aspect, ≥300×300, ≤10MB). */
  image: string;
  image_tail?: string;
  prompt?: string;
  negative_prompt?: string;
  cfg_scale?: number;
  duration?: Kling4kDuration;
  /** See Kling4kT2vGenerateParams.generate_audio. */
  generate_audio?: boolean;
  static_mask?: string;
  dynamic_masks?: Kling4kDynamicMask[];
  webhook_url?: string;
}

// --------------- WAN 2.7 image-to-video ---------------

export type WanV27Resolution = "720P" | "1080P";

/** Integer 2..15 — different from Kling's stringly-typed enum. */
export type WanV27Duration = number;

export interface WanV27AdditionalSettings {
  /** Auto-expand short prompts into richer detail before generation. */
  prompt_extend?: boolean;
}

/**
 * WAN 2.7 supports 3 generation modes determined by which input fields
 * are populated:
 *   1. First frame:        only start_image_url
 *   2. First + last frame: start_image_url + end_image_url
 *   3. Video continuation: video_url (+ optional end_image_url)
 *
 * The schema validator enforces the exclusivity rules; this type just
 * declares all possibilities so callers can pick the shape they need.
 */
export interface WanV27GenerateParams {
  prompt?: string;
  negative_prompt?: string;
  start_image_url?: string;
  end_image_url?: string;
  audio_url?: string;
  video_url?: string;
  resolution?: WanV27Resolution;
  duration?: WanV27Duration;
  seed?: number;
  additional_settings?: WanV27AdditionalSettings;
  webhook_url?: string;
}

// --------------- Kling Motion Control ---------------
//
// Four endpoints, one shared request shape: character image + reference
// motion video. Magnific keeps versions and tiers as separate URLs so
// each combination is its own resource:
//   POST /v1/ai/video/kling-v2-6-motion-control-std
//   POST /v1/ai/video/kling-v2-6-motion-control-pro
//   POST /v1/ai/video/kling-v3-motion-control-std
//   POST /v1/ai/video/kling-v3-motion-control-pro
//
// `character_orientation` drives max output duration:
//   "video" (default) → up to 30s, better for complex motion
//   "image"           → up to 10s, better when camera follows the image

export type KlingMotionVersion = "v2-6" | "v3";
export type KlingMotionTier = "std" | "pro";
export type KlingMotionOrientation = "video" | "image";

export interface KlingMotionGenerateParams {
  /** Character image URL (must be publicly accessible, 300x300+, ≤10MB). */
  image_url: string;
  /** Reference motion video URL (publicly accessible, 3-30s, MP4/MOV/WEBM/M4V). */
  video_url: string;
  /** Optional text prompt to guide the motion transfer. */
  prompt?: string;
  /**
   * Default "video". "image" caps output at 10s but follows camera
   * movements better. Magnific's docs say this is the only knob for
   * output duration — there is no explicit `duration` param.
   */
  character_orientation?: KlingMotionOrientation;
  /** 0-1, default 0.5. Higher = stronger prompt adherence. */
  cfg_scale?: number;
  webhook_url?: string;
}

// --------------- Kling 3 Omni ---------------
//
// Multi-modal Kling V3 with 3 input modes sharing the same model:
//   - T2V: prompt only
//   - I2V: start_image_url (+ optional end_image_url)
//   - V2V: video_url (reference-to-video, ref in prompt as @Video1)
//
// 4 POST endpoints (2 tiers × 2 namespaces):
//   POST /v1/ai/video/kling-v3-omni-{std|pro}            T2V + I2V
//   POST /v1/ai/reference-to-video/kling-v3-omni-{std|pro} V2V
//
// 2 GET endpoints (1 per namespace, no tier):
//   GET /v1/ai/video/kling-v3-omni/{taskId}
//   GET /v1/ai/reference-to-video/kling-v3-omni/{taskId}
//
// Same body shape across modes; absent fields = mode signal:
//   - video_url present → V2V (must POST to reference-to-video namespace)
//   - image_url/start_image_url present → I2V
//   - else → T2V

export type KlingOmniTier = "std" | "pro";
export type KlingOmniMode = "video" | "reference";
export type KlingOmniAspectRatio = "auto" | "16:9" | "9:16" | "1:1";
export type KlingOmniDuration =
  | "3" | "4" | "5" | "6" | "7" | "8"
  | "9" | "10" | "11" | "12" | "13" | "14" | "15";

export interface KlingOmniElement {
  /** Front-facing reference image (preferred for identity lock). */
  frontal_image_url?: string;
  /** Additional angles for character/object consistency. */
  reference_image_urls?: string[];
}

export interface KlingOmniGenerateParams {
  prompt?: string;
  /** Multi-shot — up to 6 sequential shot prompts. */
  multi_prompt?: string[];
  shot_type?: "customize";
  /** I2V start frame. */
  image_url?: string;
  start_image_url?: string;
  end_image_url?: string;
  /** Style guidance images — reference as @Image1..@Image4 in prompt. */
  image_urls?: string[];
  /** Character/object lock — reference as @Element1..@Element6 in prompt. */
  elements?: KlingOmniElement[];
  /** V2V reference video (only used by reference-to-video namespace). */
  video_url?: string;
  generate_audio?: boolean;
  aspect_ratio?: KlingOmniAspectRatio;
  duration?: KlingOmniDuration;
  cfg_scale?: number;
  negative_prompt?: string;
  webhook_url?: string;
}

// --------------- Improve Prompt ---------------

export type ImprovePromptType = "image" | "video";

export interface ImprovePromptParams {
  prompt: string;
  type: ImprovePromptType;
  language?: string;
  webhook_url?: string;
}
