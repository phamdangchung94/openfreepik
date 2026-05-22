"use client";

import { useCallback, useRef } from "react";
import { useTaskStore, type TaskParams } from "@/store/task-store";
import {
  getApiHeaders,
  extractErrorBody,
  requireActivationCode,
} from "@/lib/api-headers";
import { useAuthStore, type BalanceUpdate } from "@/store/auth-store";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";
import { expiresFromNow } from "@/lib/video-url-ttl";
import type {
  Kling4kI2vGenerateParams,
  Kling4kT2vGenerateParams,
  KlingMotionGenerateParams,
  KlingOmniGenerateParams,
  KlingV3GenerateParams,
  WanV27GenerateParams,
} from "@/lib/freepik/types";

/**
 * Discriminated payload — `model` (+ `variant` for Kling 4K) decides
 * both the endpoint to hit and the body shape Magnific expects.
 * Adding a new model = adding a new entry to this union + a new fetch
 * branch below.
 */
export type GeneratePayload =
  | {
      model: "kling-v3";
      params: KlingV3GenerateParams;
      tier: "pro" | "std";
    }
  | {
      model: "kling-4k";
      variant: "t2v";
      params: Kling4kT2vGenerateParams;
    }
  | {
      model: "kling-4k";
      variant: "i2v";
      params: Kling4kI2vGenerateParams;
    }
  | {
      model: "wan-v27";
      params: WanV27GenerateParams;
    }
  | {
      model: "kling-motion";
      params: KlingMotionGenerateParams;
      /** URL segment for the kling-motion/[tier] route. */
      tier: "v2-6-std" | "v2-6-pro" | "v3-std" | "v3-pro";
      /** Pricing-only — Magnific has no API duration field. */
      output_duration: number;
    }
  | {
      model: "kling-omni";
      params: KlingOmniGenerateParams;
      /** URL segment for the kling-omni/[tier] route. */
      tier: "omni-std" | "omni-pro" | "omni-ref-std" | "omni-ref-pro";
    };

interface GenerateOpts {
  prompt: string;
  /** Stored on the task so the preview header shows the right label. */
  mode: "t2v" | "i2v";
  /** I2V source image (or first frame for WAN). */
  imageUrl?: string;
}

interface UseGenerateVideoResult {
  generate: (payload: GeneratePayload, opts: GenerateOpts) => Promise<string>;
  /** Number of currently active (in-flight) generations */
  activeCount: number;
}

/**
 * Hook for single video generation — supports multiple concurrent generations.
 * Each `generate()` call is fire-and-forget: it creates the task, POSTs to API,
 * and starts polling independently. The button is NEVER blocked.
 */
export function useGenerateVideo(): UseGenerateVideoResult {
  const activeCountRef = useRef(0);
  // Reactive subscription — only for showing active count badge
  const tasks = useTaskStore((s) => s.tasks);

  // Compute active count from store (tasks that are CREATED or IN_PROGRESS)
  const activeCount = Object.values(tasks).filter(
    (t) => t.status === "CREATED" || t.status === "IN_PROGRESS"
  ).length;

  const generate = useCallback(
    async (payload: GeneratePayload, opts: GenerateOpts): Promise<string> => {
      // Validate activation code before creating task
      requireActivationCode();

      const localId = crypto.randomUUID();
      const store = useTaskStore.getState();

      // Build the param snapshot for preview/replay. Each model has a
      // different shape — branch once and pull the relevant fields.
      let paramsSnapshot: TaskParams;
      if (payload.model === "kling-v3") {
        paramsSnapshot = {
          model: "kling-v3",
          duration: payload.params.duration,
          aspectRatio: payload.params.aspect_ratio,
          audio: payload.params.generate_audio,
          cfgScale: payload.params.cfg_scale,
          negativePrompt: payload.params.negative_prompt,
          multiShot: payload.params.multi_shot,
          shotCount: payload.params.multi_prompt?.length,
        };
      } else if (payload.model === "kling-4k") {
        paramsSnapshot = {
          model: "kling-4k",
          duration: payload.params.duration,
          aspectRatio:
            payload.variant === "t2v" ? payload.params.aspect_ratio : undefined,
          // Forwarded to Magnific opportunistically — see
          // Kling4kT2vGenerateParams.generate_audio.
          audio: !!payload.params.generate_audio,
          cfgScale: payload.params.cfg_scale,
          negativePrompt: payload.params.negative_prompt,
        };
      } else if (payload.model === "kling-motion") {
        paramsSnapshot = {
          model: "kling-motion",
          // Motion duration comes from the customer-chosen output_duration
          // (Magnific has no API field). Coerce to string for shared
          // ParametersBlock display logic.
          duration: String(payload.output_duration),
          orientation:
            payload.params.character_orientation === "image"
              ? "image"
              : "video",
          motionTier: payload.tier,
          motionVideoUrl: payload.params.video_url,
          cfgScale: payload.params.cfg_scale,
        };
      } else if (payload.model === "kling-omni") {
        paramsSnapshot = {
          model: "kling-omni",
          duration: payload.params.duration,
          aspectRatio: payload.params.aspect_ratio,
          audio: !!payload.params.generate_audio,
          cfgScale: payload.params.cfg_scale,
          negativePrompt: payload.params.negative_prompt,
          multiShot: !!payload.params.multi_prompt?.length,
          shotCount: payload.params.multi_prompt?.length,
          omniTier: payload.tier,
          omniVideoUrl: payload.params.video_url,
        };
      } else {
        paramsSnapshot = {
          model: "wan-v27",
          // WAN duration is integer; coerce to string to share the
          // ParametersBlock display logic (already string-aware).
          duration: payload.params.duration?.toString(),
          aspectRatio: payload.params.resolution,
          audio: false, // Phase 1 doesn't expose audio_url
          negativePrompt: payload.params.negative_prompt,
        };
      }

      store.addTask({
        id: localId,
        taskId: null,
        status: "CREATED",
        prompt: opts.prompt,
        mode: opts.mode,
        // Tier slot doubles as a pricing/display tag — for WAN the
        // pricing lookup encodes resolution into tier (1080P=pro,
        // 720P=std). Kling 4K stores tier='4k' so the preview card
        // matches the 4K badge in admin usage logs. Motion stores
        // 'std' or 'pro' (drops the version prefix — preview UI
        // shows the full tier string via the task's endpoint).
        tier:
          payload.model === "kling-v3"
            ? payload.tier
            : payload.model === "kling-4k"
              ? "4k"
              : payload.model === "kling-motion"
                ? payload.tier.endsWith("-pro")
                  ? "pro"
                  : "std"
                : payload.model === "kling-omni"
                  ? payload.tier.endsWith("-pro") ||
                    payload.tier === "omni-pro"
                    ? "pro"
                    : "std"
                  : payload.params.resolution === "720P"
                    ? "std"
                    : "pro",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        videoUrl: null,
        videoUrlExpiresAt: null,
        downloadedAt: null,
        thumbnailUrl: null,
        imageUrl: opts.imageUrl ?? null,
        error: null,
        params: paramsSnapshot,
      });

      activeCountRef.current++;

      let endpointPath:
        | "kling-v3"
        | "wan-v27"
        | "kling-4k-t2v"
        | "kling-4k-i2v"
        | "kling-motion/v2-6-std"
        | "kling-motion/v2-6-pro"
        | "kling-motion/v3-std"
        | "kling-motion/v3-pro"
        | "kling-omni/omni-std"
        | "kling-omni/omni-pro"
        | "kling-omni/omni-ref-std"
        | "kling-omni/omni-ref-pro";
      let requestBody: object;
      if (payload.model === "kling-v3") {
        endpointPath = "kling-v3";
        requestBody = { params: payload.params, tier: payload.tier };
      } else if (payload.model === "kling-4k") {
        endpointPath = payload.variant === "t2v" ? "kling-4k-t2v" : "kling-4k-i2v";
        requestBody = { params: payload.params };
      } else if (payload.model === "kling-motion") {
        endpointPath = `kling-motion/${payload.tier}` as const;
        requestBody = {
          params: payload.params,
          output_duration: payload.output_duration,
        };
      } else if (payload.model === "kling-omni") {
        endpointPath = `kling-omni/${payload.tier}` as const;
        requestBody = { params: payload.params };
      } else {
        endpointPath = "wan-v27";
        requestBody = { params: payload.params };
      }

      // Fire-and-forget: POST + poll runs in background.
      //
      // Retry policy:
      //   NO_KEYS_AVAILABLE  → loop every 5s for up to 5 min (per-key
      //                        concurrency cap; queue drains as soon
      //                        as another task completes).
      //   ALL_KEYS_EXHAUSTED → exactly one retry after 30s (orchestrator
      //                        gave up across all keys; pool may have
      //                        recovered by then via admin add-key /
      //                        quota top-up).
      //   anything else      → fail fast.
      const RETRY_DELAY_MS = 5_000;
      const MAX_RETRY_MS = 5 * 60_000; // 5 minutes
      const ALL_KEYS_RETRY_DELAY_MS = 30_000;
      const startMs = Date.now();
      let allKeysRetried = false;

      (async () => {
        let json: { data: { task_id: string }; balance?: BalanceUpdate } | null = null;
        try {
          for (;;) {
            const res = await fetch(`/api/freepik/${endpointPath}`, {
              method: "POST",
              headers: getApiHeaders(),
              body: JSON.stringify(requestBody),
            });

            if (res.ok) {
              json = await res.json();
              break;
            }

            const err = await extractErrorBody(res);
            // Pool saturated → keep waiting. ALL_KEYS_EXHAUSTED is the
            // panic exit from the server orchestrator's per-key retry;
            // give it one more shot after a longer wait — admin often
            // adds a key or tops up quota within ~30s once they get
            // the alert.
            if (err.code === "NO_KEYS_AVAILABLE" && Date.now() - startMs < MAX_RETRY_MS) {
              useTaskStore.getState().updateTask(localId, {
                status: "QUEUED",
                error: null,
              });
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
              continue;
            }
            if (err.code === "ALL_KEYS_EXHAUSTED" && !allKeysRetried) {
              allKeysRetried = true;
              useTaskStore.getState().updateTask(localId, {
                status: "QUEUED",
                error: null,
              });
              await new Promise((r) => setTimeout(r, ALL_KEYS_RETRY_DELAY_MS));
              continue;
            }

            useTaskStore.getState().updateTask(localId, {
              status: "FAILED",
              error: err.message,
            });
            return;
          }

          if (!json) {
            useTaskStore.getState().updateTask(localId, {
              status: "FAILED",
              error: "Hàng đợi quá tải — vui lòng thử lại sau",
            });
            return;
          }
          const apiTaskId = json.data.task_id as string;
          useTaskStore.getState().updateTask(localId, {
            taskId: apiTaskId,
            status: "IN_PROGRESS",
          });
          if (json.balance) {
            useAuthStore.getState().mergeBalance(json.balance);
          }

          const result = await pollTaskUntilDone({
            apiTaskId,
            endpoint: endpointPath,
            onProgress: (status) => {
              if (status === "IN_PROGRESS") {
                useTaskStore.getState().updateTask(localId, { status });
              }
            },
          });

          if (result.status === "COMPLETED") {
            const videoUrl = result.generated[0];
            if (videoUrl) {
              useTaskStore.getState().updateTask(localId, {
                status: "COMPLETED",
                videoUrl,
                videoUrlExpiresAt: expiresFromNow(),
              });
            } else {
              // Magnific said COMPLETED but generated[] was empty — same
              // signal the server uses to auto-refund (COMPLETED_WITHOUT_URL).
              // Surface as FAILED with the code so friendlyError() can show
              // the content-policy hint instead of a broken "succeeded"
              // task with no video.
              useTaskStore.getState().updateTask(localId, {
                status: "FAILED",
                error: "COMPLETED_WITHOUT_URL",
              });
            }
          } else {
            useTaskStore.getState().updateTask(localId, {
              status: result.status === "TIMEOUT" ? "TIMEOUT" : "FAILED",
              error: result.error ?? "Generation failed",
            });
          }
        } catch (err) {
          useTaskStore.getState().updateTask(localId, {
            status: "FAILED",
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          activeCountRef.current--;
        }
      })();

      return localId;
    },
    [],
  );

  return { generate, activeCount };
}
