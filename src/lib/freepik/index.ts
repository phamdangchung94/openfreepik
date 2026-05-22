/**
 * Barrel export — single import for all Freepik API functionality.
 *
 * Usage:
 *   import { freepik, FreepikApiError } from "@/lib/freepik";
 *   const task = await freepik.klingV3.generate(params, { tier: "pro" });
 */

import * as klingV3 from "./kling-v3";
import * as kling4k from "./kling-4k";
import * as wanV27 from "./wan-v27";
import * as klingMotion from "./kling-motion";
import * as klingOmni from "./kling-omni";
import * as improvePrompt from "./improve-prompt";

export const freepik = {
  klingV3,
  kling4k,
  wanV27,
  klingMotion,
  klingOmni,
  improvePrompt,
} as const;

export { FreepikApiError } from "./errors";
export type { FreepikErrorCode, InvalidParam } from "./errors";
export type {
  TaskStatus,
  TaskData,
  FreepikResponse,
  KlingV3Tier,
  KlingV3AspectRatio,
  KlingV3Duration,
  KlingV3ShotType,
  KlingV3Element,
  KlingV3MultiPromptItem,
  KlingV3GenerateParams,
  Kling4kAspectRatio,
  Kling4kDuration,
  Kling4kT2vGenerateParams,
  Kling4kI2vGenerateParams,
  Kling4kDynamicMask,
  WanV27Resolution,
  WanV27Duration,
  WanV27AdditionalSettings,
  WanV27GenerateParams,
  KlingMotionVersion,
  KlingMotionTier,
  KlingMotionOrientation,
  KlingMotionGenerateParams,
  KlingOmniTier,
  KlingOmniMode,
  KlingOmniAspectRatio,
  KlingOmniDuration,
  KlingOmniElement,
  KlingOmniGenerateParams,
  ImprovePromptType,
  ImprovePromptParams,
} from "./types";
