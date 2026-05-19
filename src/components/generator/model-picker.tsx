"use client";

import { useFormContext } from "react-hook-form";
import { Sparkles, Move3d } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Top-of-form toggle — picks the upstream model family.
 *
 * Currently visible:
 *   - Kling 3        — text/image → video, 3 tiers (4K / 1080p Pro / 720p Std)
 *   - Kling Motion   — character image + reference video → motion-transferred output
 *
 * WAN 2.7 is temporarily hidden from the picker (per anh 2026-05-19).
 * The schema enum still includes "wan-v27" so any historical form
 * state stays valid for revert; uncomment the option below to bring
 * it back. Routes + lib + pricing rows are all intact.
 */
export function ModelPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const model = watch("model");

  function pick(next: GeneratorFormValues["model"]) {
    setValue("model", next, { shouldDirty: true });
    if (next === "wan-v27") {
      setValue("mode", "i2v", { shouldDirty: true });
    }
    if (next === "kling-motion") {
      // Motion is always image-anchored — keep mode marker consistent
      // so downstream code that checks mode for i2v branching still
      // does the right thing in mixed flows.
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
      id: "kling-motion" as const,
      label: "Kling Motion",
      sub: "Ảnh + video motion → video",
      icon: <Move3d className="size-4" />,
    },
    // {
    //   id: "wan-v27" as const,
    //   label: "WAN 2.7",
    //   sub: "Image → Video",
    //   icon: <ImageIcon className="size-4" />,
    // },
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
