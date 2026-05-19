import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { improvePromptRouteInputSchema } from "@/lib/freepik/improve-prompt-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

/**
 * POST /api/v1/prompt/improve
 *
 * Improve / expand a user prompt before submitting to the video models.
 * Returns a task_id — poll via GET /api/v1/tasks/{task_id} for the
 * expanded prompt text.
 *
 * Auth: API key via `Authorization: Bearer sk_xxx`.
 *
 * Body:
 *   { prompt: string, type: "image"|"video", language?: string }
 *
 * Response: { ok: true, task_id }
 *
 * Free of charge (cost = 0).
 */

const RATE_LIMIT_DEFAULT = 30;
const RATE_WINDOW_SEC = 60;

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const body = await parseJsonBody(request);
  const parsed = improvePromptRouteInputSchema.safeParse(body);
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

  const limit = auth.rateLimitPerMin ?? RATE_LIMIT_DEFAULT;
  const rl = await checkRateLimit({
    resource: "v1-prompt-improve",
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

  const result = await orchestrateFreepikCall({
    bearerCode: null,
    preValidated: auth.preValidated,
    endpoint: "improve-prompt",
    costEur: 0,
    prompt: parsed.data.prompt ?? null,
    callFreepik: (apiKey) =>
      freepik.improvePrompt.create(parsed.data, { apiKey }),
    extractTaskId: (data) => data.task_id,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.json({ ok: true, task_id: result.data.task_id });
}
