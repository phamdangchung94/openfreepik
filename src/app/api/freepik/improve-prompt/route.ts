import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { improvePromptRouteInputSchema } from "@/lib/freepik/improve-prompt-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";

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

  const result = await orchestrateFreepikCall({
    bearerCode: extractActivationCode(request),
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
