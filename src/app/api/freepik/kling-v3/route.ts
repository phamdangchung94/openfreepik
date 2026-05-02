import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { klingV3RouteInputSchema } from "@/lib/freepik/kling-v3-schema";
import { orchestrateFreepikCall } from "@/lib/freepik/orchestrator";
import { calculateCost, lookupForKlingV3 } from "@/lib/pricing/calculator";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";

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
  const lookup = lookupForKlingV3(params, tier);
  const cost = await calculateCost(lookup);

  const result = await orchestrateFreepikCall({
    bearerCode: extractActivationCode(request),
    endpoint: "kling-v3",
    costEur: cost,
    tier,
    durationSeconds: lookup.durationSeconds,
    withAudio: lookup.withAudio,
    callFreepik: (apiKey) => freepik.klingV3.generate(params, { tier, apiKey }),
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
