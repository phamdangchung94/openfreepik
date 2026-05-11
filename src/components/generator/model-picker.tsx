"use client";

import { useFormContext } from "react-hook-form";
import { Sparkles, ImageIcon, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Top-of-form toggle — flips between the supported video models. Each
 * model has different surface area in the rest of the form (different
 * settings cards, different validation rules, different dispatch
 * endpoint), keyed off `watch("model")`.
 *
 *   Kling 3   — text/image-to-video, Pro/Std, multi-shot, audio
 *   Kling 4K  — text/image-to-video, single 4K SKU, silent (no audio)
 *   WAN 2.7   — image-to-video only, 720P/1080P resolution
 *
 * Side effects on switch:
 *   - WAN: mode is locked to "i2v" (no t2v path upstream).
 *   - Kling 4K: model-incompatible fields (multi_shot, elements) stay
 *     in form state but are stripped in toApiParams.
 */
export function ModelPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const model = watch("model");

  function pick(next: "kling-v3" | "kling-4k" | "wan-v27") {
    setValue("model", next, { shouldDirty: true });
    if (next === "wan-v27") {
      // WAN is i2v-only.
      setValue("mode", "i2v", { shouldDirty: true });
    }
  }

  const options = [
    {
      id: "kling-v3" as const,
      label: "Kling 3",
      sub: "Text/Image → Video",
      icon: <Sparkles className="size-4" />,
    },
    {
      id: "kling-4k" as const,
      label: "Kling 4K",
      sub: "Text/Image → 4K (silent)",
      icon: <Crown className="size-4" />,
    },
    {
      id: "wan-v27" as const,
      label: "WAN 2.7",
      sub: "Image → Video",
      icon: <ImageIcon className="size-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => pick(opt.id)}
          className={cn(
            "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors",
            model === opt.id
              ? "border-primary bg-primary/5"
              : "border-border hover:border-foreground/30 hover:bg-muted/40",
          )}
          aria-pressed={model === opt.id}
        >
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {opt.icon}
            {opt.label}
          </div>
          <span className="text-[10px] text-muted-foreground">{opt.sub}</span>
        </button>
      ))}
    </div>
  );
}
