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

// --------------- Improve Prompt ---------------

export type ImprovePromptType = "image" | "video";

export interface ImprovePromptParams {
  prompt: string;
  type: ImprovePromptType;
  language?: string;
  webhook_url?: string;
}
