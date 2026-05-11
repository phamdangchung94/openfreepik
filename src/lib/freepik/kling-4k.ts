/**
 * Kling 4K API client — T2V and I2V variants share the same TaskData
 * response shape but have disjoint request paths. Each variant exposes
 * its own generate() and getTask() so the route handlers can dispatch
 * cleanly without a `mode` discriminator.
 *
 * Kling 4K has no Pro/Std tier and no audio parameter — single SKU,
 * silent video. Pricing is endpoint-keyed in pricing_rules
 * (kling-4k-t2v / kling-4k-i2v) so admin can adjust per-variant if
 * Magnific ever splits the rate.
 */

import { request } from "./base-client";
import type {
  FreepikResponse,
  Kling4kI2vGenerateParams,
  Kling4kT2vGenerateParams,
  TaskData,
} from "./types";

const T2V_BASE = "/v1/ai/video/kling-4k-t2v";
const I2V_BASE = "/v1/ai/video/kling-4k-i2v";

export async function generateT2v(
  params: Kling4kT2vGenerateParams,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path: T2V_BASE,
    body: params,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function getTaskT2v(
  taskId: string,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${T2V_BASE}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function generateI2v(
  params: Kling4kI2vGenerateParams,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "POST",
    path: I2V_BASE,
    body: params,
    apiKey: opts.apiKey,
  });
  return res.data;
}

export async function getTaskI2v(
  taskId: string,
  opts: { apiKey: string },
): Promise<TaskData> {
  const res = await request<FreepikResponse<TaskData>>({
    method: "GET",
    path: `${I2V_BASE}/${taskId}`,
    apiKey: opts.apiKey,
  });
  return res.data;
}
