import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { klingV3RouteInputSchema } from "@/lib/freepik/kling-v3-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateCost,
  lookupForKlingV3,
} from "@/lib/pricing/calculator";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

const KLING_V3_RATE_LIMIT = 30;
const KLING_V3_RATE_WINDOW_SEC = 60;

/**
 * POST /api/freepik/kling-v3
 * Header: Authorization: Bearer <activation-code>
 * Body:   { params: KlingV3GenerateParams, tier: "pro" | "std" }
 *
 * Server-side flow (orchestrated):
 *   1. validate activation code
 *   2. compute EUR cost from pricing rules
 *   3. atomic charge against the code's balance
 *   4. pick a Freepik key from the LRU pool
 *   5. call Freepik with that key
 *   6. on success: log usage; on quota error: rotate to next key; on failure: refund + log
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = klingV3RouteInputSchema.safeParse(body);
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

  const { params, tier } = parsed.data;

  // Rate limit per activation code BEFORE charging — a leaked code shared
  // among many users would otherwise drain the Freepik pool in seconds.
  // We resolve the code to its codeId so the limit is per-account, not
  // per-bearer-string (admin can't accidentally split the budget by
  // re-issuing a code with a different label).
  //
  // The validation result is reused inside the orchestrator via
  // `preValidated` to avoid a second DB roundtrip (audit #11 W1).
  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: "kling-v3",
        scope: validation.metadata.codeId,
        limit: KLING_V3_RATE_LIMIT,
        windowSeconds: KLING_V3_RATE_WINDOW_SEC,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Limit ${KLING_V3_RATE_LIMIT} requests per ${KLING_V3_RATE_WINDOW_SEC}s. Wait ${rl.retryAfterSeconds}s and retry.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  const lookup = lookupForKlingV3(params, tier);
  let cost: number;
  try {
    cost = await calculateCost(lookup);
  } catch (err) {
    // P0-5: an unhandled PricingNotFoundError used to bubble as 500 with
    // no audit trail — the request would burn a Freepik request slot
    // without billing the customer or logging anything. Now: emit the
    // documented PRICING_MISSING event and short-circuit with 503.
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

  // Webhook URL resolution deferred to the orchestrator callback so the
  // chosen key's webhook-secret capability gates the actual injection.
  // See withConditionalWebhook + 2026-05-23 stuck-task investigation.
  const webhookUrl = getWebhookUrl();

  const result = await orchestrateFreepikCall({
    bearerCode: bearer,
    preValidated: validation,
    endpoint: "kling-v3",
    costEur: cost,
    tier,
    durationSeconds: lookup.durationSeconds,
    withAudio: lookup.withAudio,
    prompt: params.prompt ?? null,
    requiresWebhook: webhookUrl !== null,
    callFreepik: (apiKey, ctx) =>
      freepik.klingV3.generate(
        withConditionalWebhook(params, webhookUrl, ctx),
        { tier, apiKey },
      ),
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
