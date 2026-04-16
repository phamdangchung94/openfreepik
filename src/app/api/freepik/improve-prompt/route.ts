import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { improvePromptRouteInputSchema } from "@/lib/freepik/improve-prompt-schema";
import { errorToResponse, parseJsonBody, extractApiKey } from "@/lib/freepik/route-helpers";

/**
 * POST /api/freepik/improve-prompt
 * Body: { prompt: string, type: "image"|"video", language?: string }
 * Header: x-api-key (user's Freepik API key)
 * Returns: { data: TaskData }
 */
export async function POST(request: Request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "AUTH", message: "API key is required." },
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

  const parsed = improvePromptRouteInputSchema.safeParse(body);
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
    const task = await freepik.improvePrompt.create(parsed.data, { apiKey });
    return NextResponse.json({ data: task });
  } catch (err) {
    return errorToResponse(err);
  }
}
