import { NextResponse } from "next/server";
import { freepik } from "@/lib/freepik";
import { errorToResponse, extractApiKey } from "@/lib/freepik/route-helpers";

/**
 * GET /api/freepik/improve-prompt/[taskId]
 * Header: x-api-key (user's Freepik API key)
 * Returns: { data: TaskData }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: "AUTH", message: "API key is required." },
      { status: 401 }
    );
  }

  const { taskId } = await params;

  if (!taskId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "taskId is required." },
      { status: 400 }
    );
  }

  try {
    const task = await freepik.improvePrompt.getTask(taskId, { apiKey });
    return NextResponse.json({ data: task });
  } catch (err) {
    return errorToResponse(err);
  }
}
