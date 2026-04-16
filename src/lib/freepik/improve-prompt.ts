/**
 * Improve Prompt API client — create() and getTask().
 * Enhances rough user prompts for video generation.
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  ImprovePromptParams,
  TaskData,
} from "./types";

const BASE = "/v1/ai/improve-prompt";

export async function create(
  params: ImprovePromptParams,
  opts: { apiKey: string }
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
  opts: { apiKey: string }
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${BASE}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}
