import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { wanV27RouteInputSchema } from "@/lib/freepik/wan-v27-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateCost,
  lookupForWanV27,
} from "@/lib/pricing/calculator";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

const WAN_V27_RATE_LIMIT = 30;
const WAN_V27_RATE_WINDOW_SEC = 60;

/**
 * POST /api/freepik/wan-v27
 * Header: Authorization: Bearer <activation-code>
 * Body:   { params: WanV27GenerateParams }
 *
 * Same orchestration shape as kling-v3 — only difference is the
 * upstream client (`freepik.wanV27`) and that WAN doesn't have a tier
 * picker (resolution is encoded into the pricing lookup's tier slot;
 * see lookupForWanV27).
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = wanV27RouteInputSchema.safeParse(body);
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

  const { params } = parsed.data;

  // Rate limit per activation code (same shape as kling-v3 — leaked
  // codes shared among many users would otherwise drain the pool).
  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: "wan-v27",
        scope: validation.metadata.codeId,
        limit: WAN_V27_RATE_LIMIT,
        windowSeconds: WAN_V27_RATE_WINDOW_SEC,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Limit ${WAN_V27_RATE_LIMIT} requests per ${WAN_V27_RATE_WINDOW_SEC}s. Wait ${rl.retryAfterSeconds}s and retry.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  const lookup = lookupForWanV27({
    duration: params.duration,
    resolution: params.resolution,
  });
  let cost: number;
  try {
    cost = await calculateCost(lookup);
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      log.warn("PRICING_MISSING", { lookup, ...errFields(err) });
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
    endpoint: "wan-v27",
    costEur: cost,
    // Tier slot doubles as resolution carrier for downstream logging.
    tier: params.resolution === "720P" ? "std" : "pro",
    durationSeconds: params.duration ?? 5,
    withAudio: false,
    prompt: params.prompt ?? null,
    requiresWebhook: webhookUrl !== null,    callFreepik: (apiKey, ctx) =>
      freepik.wanV27.generate(withConditionalWebhook(params, webhookUrl, ctx), { apiKey }),
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
