/**
 * Kling V3 API client — generate(), getTask(), listTasks().
 * All calls go through the shared base-client which attaches the API key.
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  KlingV3GenerateParams,
  KlingV3Tier,
  TaskData,
} from "./types";

const BASE = "/v1/ai/video/kling-v3";

export async function generate(
  params: KlingV3GenerateParams,
  opts: { tier: KlingV3Tier; apiKey: string }
): Promise<TaskData> {
  const path = `${BASE}-${opts.tier}`;
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path,
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

export interface ListTasksOpts {
  page?: number;
  perPage?: number;
  apiKey: string;
}

export async function listTasks(opts: ListTasksOpts): Promise<TaskData[]> {
  const query: Record<string, string> = {};
  if (opts.page) query.page = String(opts.page);
  if (opts.perPage) query.per_page = String(opts.perPage);

  const res = await request<{ data: TaskData[] }>({
    method: "GET",
    path: BASE,
    query,
    apiKey: opts.apiKey,
  });
  return res.data;
}
