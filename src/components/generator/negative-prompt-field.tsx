"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function NegativePromptField() {
  const { register, watch } = useFormContext<GeneratorFormValues>();
  const value = watch("negative_prompt") ?? "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="negative_prompt">Negative Prompt</Label>
        <span
          className={cn(
            "text-xs text-muted-foreground",
            value.length > 2500 && "text-destructive font-medium"
          )}
        >
          {value.length}/2500
        </span>
      </div>
      <Textarea
        id="negative_prompt"
        rows={2}
        placeholder="blur, distort, and low quality"
        {...register("negative_prompt")}
      />
    </div>
  );
}
