/**
 * WAN 2.7 image-to-video API client — generate(), getTask().
 * All calls go through the shared base-client which attaches the API
 * key, sanitizes upstream brand strings, and maps HTTP errors.
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  TaskData,
  WanV27GenerateParams,
} from "./types";

const BASE = "/v1/ai/image-to-video/wan-2-7";

export async function generate(
  params: WanV27GenerateParams,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path: BASE,
    body: params,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function getTask(
  taskId: string,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${BASE}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}
