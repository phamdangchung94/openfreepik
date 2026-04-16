import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { klingV3RouteInputSchema } from "@/lib/freepik/kling-v3-schema";
import { errorToResponse, parseJsonBody, extractApiKey } from "@/lib/freepik/route-helpers";

/**
 * POST /api/freepik/kling-v3
 * Body: { params: KlingV3GenerateParams, tier: "pro" | "std" }
 * Header: x-api-key (user's Freepik API key)
 * Returns: { data: TaskData }
 */
export async function POST(request: Request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "AUTH", message: "API key is required. Set your Freepik API key first." },
      { status: 401 }
    );
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const parsed = klingV3RouteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "Validation failed.",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const task = await freepik.klingV3.generate(
      parsed.data.params,
      { tier: parsed.data.tier, apiKey }
    );
    return NextResponse.json({ data: task });
  } catch (err) {
    return errorToResponse(err);
  }
}
