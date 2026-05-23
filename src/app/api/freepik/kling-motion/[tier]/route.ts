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
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/freepik/kling-motion/[tier]
 * Header: Authorization: Bearer <activation-code>
 * Body:   { params: KlingMotionGenerateParams, output_duration: number }
 *
 * `[tier]` is one of: v2-6-std, v2-6-pro, v3-std, v3-pro. Drives both
 * the upstream endpoint URL (via ENDPOINT_MAP in kling-motion.ts) and
 * the pricing row lookup (`kling-motion-${tier}`).
 *
 * Pricing model: motion control bills by output duration. Customer
 * picks 5/10/15/30s on the form; the value flows through here as
 * `output_duration`, gets validated against character_orientation
 * (image caps at 10s, video at 30s), then used as the durationSeconds
 * input to the pricing lookup. The upstream API has no duration param
 * — it's controlled implicitly by character_orientation.
 */

const KLING_MOTION_RATE_LIMIT = 30;
const KLING_MOTION_RATE_WINDOW_SEC = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tier: string }> },
) {
  const { tier: tierParam } = await params;
  const parsedTier = parseTierParam(tierParam);
  if (!parsedTier) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: `Unknown tier: ${tierParam}. Expected v2-6-std | v2-6-pro | v3-std | v3-pro.`,
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
        error: "BAD_REQUEST",
        message: "Validation failed.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { params: motionParams, output_duration: durationSeconds } = parsed.data;

  // Output duration vs orientation cap — defended at the route boundary
  // so customers can't bypass the form-side enforcement by curling
  // direct.
  const orientationError = validateOutputDuration(
    durationSeconds,
    motionParams.character_orientation,
  );
  if (orientationError) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: orientationError },
      { status: 400 },
    );
  }

  // Rate limit per activation code — same shape as kling-v3 / wan-v27.
  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: slug,
        scope: validation.metadata.codeId,
        limit: KLING_MOTION_RATE_LIMIT,
        windowSeconds: KLING_MOTION_RATE_WINDOW_SEC,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Limit ${KLING_MOTION_RATE_LIMIT} requests per ${KLING_MOTION_RATE_WINDOW_SEC}s. Wait ${rl.retryAfterSeconds}s and retry.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  // Pricing — per-second billing with ceiling rounding (2026-05-20).
  // calculateMotionCost reads any one row for the endpoint, derives
  // per-second rate, and multiplies by ceil(durationSeconds).
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
        {
          error: "PRICING_MISSING",
          message:
            "Cấu hình giá tạm thời không khả dụng — vui lòng liên hệ hỗ trợ.",
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
    bearerCode: bearer,
    preValidated: validation,
    endpoint: slug,
    costEur: cost,
    // tier slot left null for motion — version+tier already baked into
    // `endpoint`. Surfacing them again as `tier` would conflict with
    // the kling-v3 'pro'/'std' semantic on the usage_logs row.
    tier: null,
    durationSeconds,
    withAudio: false,
    prompt: motionParams.prompt ?? null,
    requiresWebhook: webhookUrl !== null,    callFreepik: (apiKey, ctx) =>
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

  return NextResponse.json({
    data: result.data,
    balance: {
      mode: result.metadata.mode,
      usedEur: result.metadata.usedEur,
      quotaEur: result.metadata.quotaEur,
      remainingEur: result.metadata.remainingEur,
    },
  });
}
