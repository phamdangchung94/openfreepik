/** Shared types for all Freepik API endpoints. */

export type TaskStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface TaskData {
  task_id: string;
  status: TaskStatus;
  generated: string[];
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

// --------------- Improve Prompt ---------------

export type ImprovePromptType = "image" | "video";

export interface ImprovePromptParams {
  prompt: string;
  type: ImprovePromptType;
  language?: string;
  webhook_url?: string;
}
