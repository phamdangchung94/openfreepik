import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { kling4kT2vRouteInputSchema } from "@/lib/freepik/kling-4k-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateCost,
  lookupForKling4k,
} from "@/lib/pricing/calculator";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/v1/video/kling-3-4k-text
 *
 * Public API for Kling 3 4K text-to-video.
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Body:
 *   { "params": { prompt, aspect_ratio?, duration?, cfg_scale?, generate_audio? } }
 *
 * Response: { ok: true, task_id, balance }
 */

const RATE_LIMIT_DEFAULT = 30;
const RATE_WINDOW_SEC = 60;

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const body = await parseJsonBody(request);
  const parsed = kling4kT2vRouteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: "Validation failed.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { params } = parsed.data;

  const limit = auth.rateLimitPerMin ?? RATE_LIMIT_DEFAULT;
  const rl = await checkRateLimit({
    resource: "v1-kling-3-4k-text",
    scope: auth.apiKeyId,
    limit,
    windowSeconds: RATE_WINDOW_SEC,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT",
        message: `Limit ${limit} req/${RATE_WINDOW_SEC}s — retry in ${rl.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  const lookup = lookupForKling4k("kling-4k-t2v", params);
  let cost: number;
  try {
    cost = await calculateCost(lookup);
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      log.warn("PRICING_MISSING", { lookup, ...errFields(err) });
      return NextResponse.json(
        {
          ok: false,
          error: "PRICING_MISSING",
          message: "No price configured for this request shape.",
        },
        { status: 503 },
      );
    }
    throw err;
  }

  const webhookUrl = getWebhookUrl();

  // Webhook URL inject conditional theo key picked — orchestrator
  // gate qua requiresWebhook + withConditionalWebhook (2026-05-23).

  const result = await orchestrateFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    endpoint: "kling-4k-t2v",
    costEur: cost,
    tier: "4k",
    durationSeconds: lookup.durationSeconds,
    withAudio: lookup.withAudio,
    prompt: params.prompt ?? null,
    requiresWebhook: webhookUrl !== null,    callFreepik: (apiKey, ctx) =>
      freepik.kling4k.generateT2v(withConditionalWebhook(params, webhookUrl, ctx), { apiKey }),
    extractTaskId: (data) => data.task_id,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    task_id: result.data.task_id,
    balance: {
      mode: result.metadata.mode,
      usedEur: result.metadata.usedEur,
      quotaEur: result.metadata.quotaEur,
      remainingEur: result.metadata.remainingEur,
    },
  });
}
