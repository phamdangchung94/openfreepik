import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import {
  klingMotionRouteInputSchema,
  parseTierParam,
  validateOutputDuration,
} from "@/lib/freepik/kling-motion-schema";
import { endpointSlug } from "@/lib/freepik/kling-motion";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateMotionCost,
} from "@/lib/pricing/calculator";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { extractCustomerWebhookUrl } from "@/lib/api-v1/response";
import { beginIdempotency } from "@/lib/api-v1/idempotency";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/v1/video/kling-motion/[tier]
 *
 * `[tier]`: v2-6-std | v2-6-pro | v3-std | v3-pro
 *
 * Public API for character image + reference video → motion-transfer
 * video. Same upstream as the web UI's Kling Motion flow.
 *
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Body:
 *   {
 *     "params": {
 *       "image_url": "https://...",
 *       "video_url": "https://...",
 *       "prompt": "optional guidance",
 *       "character_orientation": "video" | "image",
 *       "cfg_scale": 0.5
 *     },
 *     "output_duration": 5 | 10 | 15 | 30
 *   }
 *
 * Response: { ok: true, task_id, balance }
 */

const RATE_LIMIT_DEFAULT = 30;
const RATE_WINDOW_SEC = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tier: string }> },
) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { tier: tierParam } = await params;
  const parsedTier = parseTierParam(tierParam);
  if (!parsedTier) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: `Unknown tier "${tierParam}". Expected v2-6-std | v2-6-pro | v3-std | v3-pro.`,
      },
      { status: 400 },
    );
  }
  const { version, tier } = parsedTier;
  const slug = endpointSlug(version, tier);

  const body = await parseJsonBody(request);
  const parsed = klingMotionRouteInputSchema.safeParse(body);
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

  const { params: motionParams, output_duration: durationSeconds } = parsed.data;
  const orientationError = validateOutputDuration(
    durationSeconds,
    motionParams.character_orientation,
  );
  if (orientationError) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: orientationError },
      { status: 400 },
    );
  }

  const limit = auth.rateLimitPerMin ?? RATE_LIMIT_DEFAULT;
  const rl = await checkRateLimit({
    resource: `v1-${slug}`,
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

  let cost: number;
  try {
    cost = await calculateMotionCost(slug, durationSeconds);
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      log.warn("PRICING_MISSING", {
        lookup: { endpoint: slug, durationSeconds },
        ...errFields(err),
      });
      return NextResponse.json(
        { ok: false, error: "PRICING_MISSING", message: "No price configured." },
        { status: 503 },
      );
    }
    throw err;
  }

  const webhookUrl = getWebhookUrl();

  // Webhook URL inject conditional theo key picked — orchestrator
  // gate qua requiresWebhook + withConditionalWebhook (2026-05-23).

  const idem = await beginIdempotency(request, body, auth);
  if (idem.replay) return idem.replay;

  const result = await orchestrateFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    endpoint: slug,
    costEur: cost,
    tier: null,
    durationSeconds,
    withAudio: false,
    prompt: motionParams.prompt ?? null,
    requiresWebhook: webhookUrl !== null,    customerWebhookUrl: extractCustomerWebhookUrl(body),    apiKeyId: auth.apiKeyId,    callFreepik: (apiKey, ctx) =>
      freepik.klingMotion.generate(withConditionalWebhook(motionParams, webhookUrl, ctx), {
        version,
        tier,
        apiKey,
      }),
    extractTaskId: (data) => data.task_id,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const responseBody = {
    ok: true,
    task_id: result.data.task_id,
    balance: {
      mode: result.metadata.mode,
      usedEur: result.metadata.usedEur,
      quotaEur: result.metadata.quotaEur,
      remainingEur: result.metadata.remainingEur,
    },
  };
  await idem.commit({ status: 200, body: responseBody });
  return NextResponse.json(responseBody);
}
