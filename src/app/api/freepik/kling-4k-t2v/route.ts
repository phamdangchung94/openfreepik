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
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 60;

/**
 * POST /api/freepik/kling-4k-t2v
 * Header: Authorization: Bearer <activation-code>
 * Body:   { params: Kling4kT2vGenerateParams }
 *
 * Same orchestrated flow as kling-v3 — validate → charge → pool → call →
 * log pending. Cost comes from pricing_rules row keyed by
 * endpoint='kling-4k-t2v' + duration; admin seeds with the 2.857×
 * Kling-V3-Pro-1080p-with-audio multiplier.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = kling4kT2vRouteInputSchema.safeParse(body);
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

  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: "kling-4k-t2v",
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

  const lookup = lookupForKling4k("kling-4k-t2v", params);
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
    data: result.data,
    balance: {
      mode: result.metadata.mode,
      usedEur: result.metadata.usedEur,
      quotaEur: result.metadata.quotaEur,
      remainingEur: result.metadata.remainingEur,
    },
  });
}
