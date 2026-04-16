/**
 * Custom zod resolver for react-hook-form.
 * Bypasses @hookform/resolvers zod version detection issues with zod v4.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod/v4";

export function customZodResolver<T extends FieldValues>(
  schema: z.ZodType<T>
): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);

    if (result.success) {
      return { values: result.data, errors: {} } as any;
    }

    const fieldErrors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (path && !fieldErrors[path]) {
        fieldErrors[path] = {
          type: issue.code,
          message: issue.message,
        };
      }
    }

    return { values: {}, errors: fieldErrors } as any;
  };
}
