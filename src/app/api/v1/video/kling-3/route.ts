import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { klingV3RouteInputSchema } from "@/lib/freepik/kling-v3-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  PricingNotFoundError,
  calculateCost,
  lookupForKlingV3,
  type PricingResult,
} from "@/lib/pricing/calculator";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { extractCustomerWebhookUrl } from "@/lib/api-v1/response";
import { beginIdempotency } from "@/lib/api-v1/idempotency";
import { getWebhookUrl, withConditionalWebhook } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/v1/video/kling-3
 *
 * Public API endpoint for Kling 3 text-to-video / image-to-video.
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Body:
 *   {
 *     "tier": "pro" | "std",
 *     "params": { prompt?, aspect_ratio, duration, generate_audio, … }
 *   }
 *
 * Response 200:
 *   { ok: true, task_id: "uuid", balance: { mode, used, quota, remaining } }
 *
 * Poll the task via GET /api/v1/tasks/{task_id}.
 */

const RATE_LIMIT_DEFAULT = 30;
const RATE_WINDOW_SEC = 60;

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const body = await parseJsonBody(request);
  const parsed = klingV3RouteInputSchema.safeParse(body);
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

  const { params, tier } = parsed.data;

  // Per-key rate limit override; default = endpoint default. Scope to
  // the API key id so two keys on the same activation code don't
  // share each other's bucket.
  const limit = auth.rateLimitPerMin ?? RATE_LIMIT_DEFAULT;
  const rl = await checkRateLimit({
    resource: "v1-kling-3",
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

  const lookup = lookupForKlingV3(params, tier);
  let pricing: PricingResult;
  try {
    pricing = await calculateCost(lookup);
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

  const idem = await beginIdempotency(request, body, auth);
  if (idem.replay) return idem.replay;

  const result = await orchestrateFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    endpoint: "kling-v3",
    costEur: pricing.customerPriceEur,
    upstreamCostEur: pricing.upstreamCostEur,
    tier,
    durationSeconds: Number(params.duration ?? 5),
    withAudio: !!params.generate_audio,
    prompt: params.prompt ?? null,
    requiresWebhook: webhookUrl !== null,    customerWebhookUrl: extractCustomerWebhookUrl(body),    apiKeyId: auth.apiKeyId,    callFreepik: (apiKey, ctx) => freepik.klingV3.generate(withConditionalWebhook(params, webhookUrl, ctx), { apiKey, tier }),
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
