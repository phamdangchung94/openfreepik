"use client";

import { useFormContext } from "react-hook-form";
import { Sparkles, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Top-of-form toggle — flips between the Kling 3 (text/image-to-video,
 * multi-tier, multi-shot) and WAN 2.7 (image-to-video only, resolution
 * picker, simpler) request shapes.
 *
 * Side effects on switch to WAN:
 *   - mode is locked to "i2v" (WAN has no t2v).
 *   - Kling-only fields stay in form state but are not rendered (the
 *     submit handler in to-api-params reads only the fields relevant
 *     to the chosen model).
 */
export function ModelPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const model = watch("model");

  function pick(next: "kling-v3" | "wan-v27") {
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
      id: "wan-v27" as const,
      label: "WAN 2.7",
      sub: "Image → Video",
      icon: <ImageIcon className="size-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
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
