import { freepik } from "@/lib/freepik";
import { createTaskGetHandler } from "@/lib/freepik/route-helpers";

/**
 * GET /api/freepik/improve-prompt/[taskId]
 * Header: x-api-key (user's Freepik API key)
 * Returns: { data: TaskData }
 */
export const GET = createTaskGetHandler(freepik.improvePrompt.getTask);
