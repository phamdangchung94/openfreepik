/** Zod schemas for Improve Prompt request validation. */

import { z } from "zod";

export const improvePromptRouteInputSchema = z.object({
  prompt: z.string().max(2500),
  type: z.enum(["image", "video"]),
  language: z.string().max(10).optional(),
  webhook_url: z.string().url().optional(),
});

export type ImprovePromptRouteInput = z.infer<
  typeof improvePromptRouteInputSchema
>;
