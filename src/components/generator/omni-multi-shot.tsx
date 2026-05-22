"use client";

import { useFormContext, useFieldArray } from "react-hook-form";
import { Plus, Trash2, Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MAX_SHOTS = 6;

/**
 * Omni-specific multi-shot — separate from Kling V3's because anh
 * muốn iterate UI riêng cho từng model. Same Zod field name pattern
 * (`omni_multi_prompt[N].prompt`) so toggle on/off is local state.
 *
 * Each shot = single prompt string (no per-shot duration unlike V3).
 * Magnific Omni handles shot pacing automatically when shot_type =
 * "customize"; total duration capped by top-level `omni_duration`.
 */
export function OmniMultiShot() {
  const { register, control, watch, setValue } =
    useFormContext<GeneratorFormValues>();
  const enabled = watch("omni_multi_shot");

  const { fields, append, remove } = useFieldArray({
    control,
    name: "omni_multi_prompt",
  });

  function toggle() {
    const next = !enabled;
    setValue("omni_multi_shot", next, { shouldDirty: true });
    // Seed first empty shot on enable so user sees the input immediately.
    if (next && fields.length === 0) {
      append({ prompt: "" });
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <Layers className="size-3.5" />
          Multi-shot (đa cảnh)
        </Label>
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-muted",
          )}
          aria-pressed={enabled}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-background transition-transform",
              enabled ? "left-4" : "left-0.5",
            )}
          />
        </button>
      </div>

      {enabled && (
        <>
          <p className="text-[10px] text-muted-foreground">
            Tối đa {MAX_SHOTS} cảnh. Omni tự ghép thứ tự theo prompt;
            tổng thời lượng vẫn theo trường &ldquo;Thời lượng&rdquo; trên.
          </p>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <span className="mt-2 size-6 shrink-0 rounded bg-muted text-center text-[11px] font-medium leading-6">
                  {i + 1}
                </span>
                <Textarea
                  rows={2}
                  placeholder={`Cảnh ${i + 1}…`}
                  {...register(`omni_multi_prompt.${i}.prompt`)}
                  className="flex-1 text-xs"
                />
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => remove(i)}
                    title="Xoá cảnh"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            {fields.length < MAX_SHOTS && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => append({ prompt: "" })}
                className="w-full"
              >
                <Plus className="size-3.5" />
                Thêm cảnh ({fields.length}/{MAX_SHOTS})
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
