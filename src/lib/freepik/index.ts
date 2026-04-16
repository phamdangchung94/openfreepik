/**
 * Barrel export — single import for all Freepik API functionality.
 *
 * Usage:
 *   import { freepik, FreepikApiError } from "@/lib/freepik";
 *   const task = await freepik.klingV3.generate(params, { tier: "pro" });
 */

import * as klingV3 from "./kling-v3";
import * as improvePrompt from "./improve-prompt";

export const freepik = { klingV3, improvePrompt } as const;

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
  ImprovePromptType,
  ImprovePromptParams,
} from "./types";
