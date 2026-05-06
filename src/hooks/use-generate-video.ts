"use client";

import { useCallback, useRef } from "react";
import { useTaskStore } from "@/store/task-store";
import { getApiHeaders, extractErrorMessage, requireActivationCode } from "@/lib/api-headers";
import { useAuthStore } from "@/store/auth-store";
import { pollTaskUntilDone } from "@/lib/freepik/poll-task";
import { expiresFromNow } from "@/lib/video-url-ttl";
import type {
  KlingV3GenerateParams,
  WanV27GenerateParams,
} from "@/lib/freepik/types";

/**
 * Discriminated payload — `model` decides both the endpoint to hit and
 * the body shape Magnific expects. Adding a new model = adding a new
 * entry to this union + a new fetch branch below.
 */
export type GeneratePayload =
  | {
      model: "kling-v3";
      params: KlingV3GenerateParams;
      tier: "pro" | "std";
    }
  | {
      model: "wan-v27";
      params: WanV27GenerateParams;
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
      const paramsSnapshot =
        payload.model === "kling-v3"
          ? {
              duration: payload.params.duration,
              aspectRatio: payload.params.aspect_ratio,
              audio: payload.params.generate_audio,
              cfgScale: payload.params.cfg_scale,
              negativePrompt: payload.params.negative_prompt,
              multiShot: payload.params.multi_shot,
              shotCount: payload.params.multi_prompt?.length,
            }
          : {
              // WAN duration is integer; coerce to string to share the
              // ParametersBlock display logic (already string-aware).
              duration: payload.params.duration?.toString(),
              aspectRatio: payload.params.resolution,
              audio: false, // Phase 1 doesn't expose audio_url
              negativePrompt: payload.params.negative_prompt,
            };

      store.addTask({
        id: localId,
        taskId: null,
        status: "CREATED",
        prompt: opts.prompt,
        mode: opts.mode,
        // Tier slot doubles as a pricing/display tag — for WAN the
        // pricing lookup encodes resolution into tier (1080P=pro,
        // 720P=std). Keeps the task summary single-row.
        tier:
          payload.model === "kling-v3"
            ? payload.tier
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

      const endpointPath =
        payload.model === "kling-v3" ? "kling-v3" : "wan-v27";
      const requestBody =
        payload.model === "kling-v3"
          ? { params: payload.params, tier: payload.tier }
          : { params: payload.params };

      // Fire-and-forget: POST + poll runs in background
      (async () => {
        try {
          const res = await fetch(`/api/freepik/${endpointPath}`, {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const errMsg = await extractErrorMessage(res);
            useTaskStore.getState().updateTask(localId, {
              status: "FAILED",
              error: errMsg,
            });
            return;
          }

          const json = await res.json();
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
            useTaskStore.getState().updateTask(localId, {
              status: "COMPLETED",
              videoUrl: result.generated[0] ?? null,
              videoUrlExpiresAt: expiresFromNow(),
            });
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
