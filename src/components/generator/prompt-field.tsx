"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

interface PromptFieldProps {
  /** Slot for the Improve Prompt button (wired in Phase 4) */
  improveButton?: React.ReactNode;
}

export function PromptField({ improveButton }: PromptFieldProps) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<GeneratorFormValues>();
  const value = watch("prompt") ?? "";
  const charCount = value.length;
  const mode = watch("mode");
  const isRequired = mode === "t2v";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="prompt">
          Prompt {isRequired && <span className="text-destructive">*</span>}
        </Label>
        <div className="flex items-center gap-2">
          {improveButton}
          <span
            className={cn(
              "text-xs text-muted-foreground",
              charCount > 2500 && "text-amber-500 font-medium"
            )}
          >
            {charCount}
            {charCount > 2500 && " (API limit: 2500)"}
          </span>
        </div>
      </div>
      <Textarea
        id="prompt"
        rows={4}
        placeholder="A cinematic shot of a cat exploring a neon-lit Tokyo alley at night..."
        {...register("prompt")}
      />
      {errors.prompt && (
        <p className="text-sm text-destructive">{errors.prompt.message}</p>
      )}
    </div>
  );
}
