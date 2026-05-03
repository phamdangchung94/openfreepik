import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { improvePromptRouteInputSchema } from "@/lib/freepik/improve-prompt-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCode, type ValidationResult } from "@/lib/auth/activation";

// improve-prompt is free per pricing rules but still hits Freepik. Cap
// at 30/min so a runaway client can't burn the pool's request quota.
const IMPROVE_PROMPT_RATE_LIMIT = 30;
const IMPROVE_PROMPT_RATE_WINDOW_SEC = 60;

/**
 * POST /api/freepik/improve-prompt
 * Header: Authorization: Bearer <activation-code>
 * Body:   { prompt: string, type: "image"|"video", language?: string }
 *
 * Same orchestration as kling-v3 but with cost=0 — improve-prompt is
 * priced as free in pricing_rules, so we still validate the code and
 * pick a key from the pool, but skip charging.
 */
export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = improvePromptRouteInputSchema.safeParse(body);
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

  // Rate limit per code BEFORE the orchestrator picks a key, so a misbehaving
  // client can't burn the pool's per-key request quota. Re-validate once
  // and pass the result through to skip a second DB roundtrip.
  const bearer = extractActivationCode(request);
  let validation: ValidationResult | undefined;
  if (bearer) {
    validation = await validateCode(bearer);
    if (validation.ok) {
      const rl = await checkRateLimit({
        resource: "improve-prompt",
        scope: validation.metadata.codeId,
        limit: IMPROVE_PROMPT_RATE_LIMIT,
        windowSeconds: IMPROVE_PROMPT_RATE_WINDOW_SEC,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: "RATE_LIMIT",
            message: `Limit ${IMPROVE_PROMPT_RATE_LIMIT} requests per ${IMPROVE_PROMPT_RATE_WINDOW_SEC}s. Wait ${rl.retryAfterSeconds}s and retry.`,
          },
          {
            status: 429,
            headers: { "retry-after": String(rl.retryAfterSeconds) },
          },
        );
      }
    }
  }

  const result = await orchestrateFreepikCall({
    bearerCode: bearer,
    preValidated: validation,
    endpoint: "improve-prompt",
    costEur: 0,
    callFreepik: (apiKey) =>
      freepik.improvePrompt.create(parsed.data, { apiKey }),
    extractTaskId: (data) => data.task_id,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json({ data: result.data });
}
