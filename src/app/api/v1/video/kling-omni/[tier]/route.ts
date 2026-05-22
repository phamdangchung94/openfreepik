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
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { getWebhookUrl } from "@/lib/freepik/webhook-url";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/v1/video/kling-omni/[tier]
 *
 * `[tier]`: omni-std | omni-pro | omni-ref-std | omni-ref-pro
 *
 * Public API for Kling 3 Omni — multi-modal video (T2V/I2V/V2V).
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Body shape matches schema (image/start_image_url for I2V, video_url
 * for V2V, prompt or multi_prompt for content).
 *
 * Response: { ok: true, task_id, balance }
 */

const RATE_LIMIT_DEFAULT = 10;
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
        ok: false,
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
      { ok: false, error: "BAD_REQUEST", message: modeError },
      { status: 400 },
    );
  }

  const omniParams = parsed.data.params;
  const withAudio = !!omniParams.generate_audio;
  const durationSeconds = Number(omniParams.duration ?? "5");

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
    cost = await calculateOmniCost(slug, durationSeconds, withAudio);
  } catch (err) {
    if (err instanceof PricingNotFoundError) {
      log.warn("PRICING_MISSING", {
        lookup: { endpoint: slug, durationSeconds, withAudio },
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
  const paramsWithWebhook = webhookUrl
    ? { ...omniParams, webhook_url: webhookUrl }
    : omniParams;

  const result = await orchestrateFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    endpoint: slug,
    costEur: cost,
    tier: null,
    durationSeconds,
    withAudio,
    prompt:
      omniParams.prompt ?? omniParams.multi_prompt?.join(" / ") ?? null,
    callFreepik: (apiKey) =>
      freepik.klingOmni.generate(paramsWithWebhook, {
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
