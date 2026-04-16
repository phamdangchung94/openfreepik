"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const RATIOS = [
  { value: "16:9" as const, label: "16:9", w: 32, h: 18 },
  { value: "9:16" as const, label: "9:16", w: 18, h: 32 },
  { value: "1:1" as const, label: "1:1", w: 24, h: 24 },
];

export function AspectRatioPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("aspect_ratio");

  return (
    <div className="space-y-2">
      <Label>Aspect Ratio</Label>
      <div className="flex gap-2">
        {RATIOS.map(({ value, label, w, h }) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            className={cn(
              "flex flex-col items-center gap-1.5 px-4 py-3 h-auto",
              current === value && "border-primary bg-primary/5 ring-1 ring-primary"
            )}
            onClick={() => setValue("aspect_ratio", value)}
          >
            <div
              className={cn(
                "rounded-sm border-2",
                current === value ? "border-primary" : "border-muted-foreground/30"
              )}
              style={{ width: w, height: h }}
            />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
