"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/** Omni aspect picker — adds "auto" (Magnific picks based on input). */
const OPTIONS = [
  { id: "auto" as const, label: "Auto", sub: "Theo input" },
  { id: "16:9" as const, label: "16:9", sub: "Widescreen" },
  { id: "9:16" as const, label: "9:16", sub: "Vertical" },
  { id: "1:1" as const, label: "1:1", sub: "Square" },
];

export function OmniAspectRatioPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("omni_aspect_ratio");
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Tỉ lệ khung hình</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() =>
              setValue("omni_aspect_ratio", opt.id, { shouldDirty: true })
            }
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md border p-2 transition-colors",
              current === opt.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-foreground/30 hover:bg-muted/40",
            )}
            aria-pressed={current === opt.id}
          >
            <span className="text-xs font-medium">{opt.label}</span>
            <span className="text-[9px] text-muted-foreground">{opt.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
