"use client";

import { useFormContext } from "react-hook-form";
import { Type, ImageIcon, Film } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * 3-button picker for Kling Omni input mode:
 *   T2V — text prompt only
 *   I2V — start_image_url (Magnific same "video" namespace as T2V)
 *   V2V — reference video (Magnific "reference-to-video" namespace)
 *
 * Maps to two form fields:
 *   omni_mode  = "video" | "reference"   (URL namespace → endpoint slug)
 *   omni_input = "t2v"   | "i2v"         (UI-only marker within video mode)
 *
 * V2V is exclusive to omni_mode="reference"; T2V and I2V both live
 * under omni_mode="video" but the route handler validates required
 * fields based on omni_input.
 */
export function OmniModePicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const mode = watch("omni_mode");
  const input = watch("omni_input");

  const current: "t2v" | "i2v" | "v2v" =
    mode === "reference" ? "v2v" : input;

  function pick(next: "t2v" | "i2v" | "v2v") {
    if (next === "v2v") {
      setValue("omni_mode", "reference", { shouldDirty: true });
    } else {
      setValue("omni_mode", "video", { shouldDirty: true });
      setValue("omni_input", next, { shouldDirty: true });
    }
  }

  const options = [
    {
      id: "t2v" as const,
      label: "T2V",
      sub: "Text → Video",
      icon: <Type className="size-4" />,
    },
    {
      id: "i2v" as const,
      label: "I2V",
      sub: "Ảnh đầu → Video",
      icon: <ImageIcon className="size-4" />,
    },
    {
      id: "v2v" as const,
      label: "V2V",
      sub: "Video tham chiếu → Video",
      icon: <Film className="size-4" />,
    },
  ];

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Chế độ tạo video</Label>
      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => pick(opt.id)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors",
              current === opt.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-foreground/30 hover:bg-muted/40",
            )}
            aria-pressed={current === opt.id}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {opt.icon}
              {opt.label}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {opt.sub}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
