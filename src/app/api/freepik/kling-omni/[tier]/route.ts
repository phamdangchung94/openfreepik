import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import {
  klingOmniRouteInputSchema,
  parseTierParam,
  validateModeFields,
} from "@/lib/freepik/kling-omni-schema";
import { endpointSlug } from "@/lib/freepik/kling-omni";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateOmniCost,
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
 * POST /api/freepik/kling-omni/[tier]
 * Header: Authorization: Bearer <activation-code>
 * Body:   { params: KlingOmniGenerateParams }
 *
 * [tier]: omni-std | omni-pro | omni-ref-std | omni-ref-pro
 *
 * Magnific routes per (mode, tier). Mode is encoded in URL namespace:
 *   video     → /v1/ai/video/kling-v3-omni-{std|pro}
 *   reference → /v1/ai/reference-to-video/kling-v3-omni-{std|pro}
 *
 * Pricing: per-second × ceil(duration), audio variant ~1.5x base.
 * Customer-chosen `duration` (3-15s string enum) drives billing.
 */

const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 60;

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
        message: `Unknown tier "${tierParam}". Expected omni-std | omni-pro | omni-ref-std | omni-ref-pro.`,
      },
      { status: 400 },
    );
  }
  const { mode, tier } = parsedTier;
  const slug = endpointSlug(mode, tier);

  const body = await parseJsonBody(request);
  const parsed = klingOmniRouteInputSchema.safeParse(body);
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

  const modeError = validateModeFields(mode, parsed.data.params);
  if (modeError) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: modeError },
      { status: 400 },
    );
  }

  const omniParams = parsed.data.params;
  const withAudio = !!omniParams.generate_audio;
  // Default 5s if customer didn't specify — matches Magnific docs default.
  const durationSeconds = Number(omniParams.duration ?? "5");

  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: slug,
        scope: validation.metadata.codeId,
        limit: RATE_LIMIT,
        windowSeconds: RATE_WINDOW_SEC,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Limit ${RATE_LIMIT} requests per ${RATE_WINDOW_SEC}s. Wait ${rl.retryAfterSeconds}s and retry.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  let cost: number;
  try {
    cost = await calculateOmniCost(slug, durationSeconds, withAudio);
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      log.warn("PRICING_MISSING", {
        lookup: { endpoint: slug, durationSeconds, withAudio },
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
    tier: null,
    durationSeconds,
    withAudio,
    prompt:
      omniParams.prompt ?? omniParams.multi_prompt?.join(" / ") ?? null,
    requiresWebhook: webhookUrl !== null,    callFreepik: (apiKey, ctx) =>
      freepik.klingOmni.generate(withConditionalWebhook(omniParams, webhookUrl, ctx), {
        mode,
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
