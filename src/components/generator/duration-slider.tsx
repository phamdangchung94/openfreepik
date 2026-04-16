"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";
import type { KlingV3Duration } from "@/lib/freepik/types";

export function DurationSlider() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("duration");
  const numValue = parseInt(current ?? "5", 10);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Duration</Label>
        <span className="text-sm font-medium tabular-nums">{numValue}s</span>
      </div>
      <Slider
        min={3}
        max={15}
        step={1}
        value={[numValue]}
        onValueChange={(val) => {
          const v = Array.isArray(val) ? val[0] : val;
          if (v !== undefined) {
            setValue("duration", String(v) as KlingV3Duration);
          }
        }}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>3s</span>
        <span>15s</span>
      </div>
    </div>
  );
}
