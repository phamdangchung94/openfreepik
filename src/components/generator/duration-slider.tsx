"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function DurationSlider() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("duration");
  const model = watch("model");
  const numValue = parseInt(current ?? "5", 10);
  // Kling supports 3–15s; WAN 2.7 supports 2–15s. Slider min/floor
  // adapts so the customer can hit the lower bound on WAN.
  const min = model === "wan-v27" ? 2 : 3;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Thời lượng</Label>
        <span className="text-sm font-medium tabular-nums">{numValue}s</span>
      </div>
      <Slider
        min={min}
        max={15}
        step={1}
        value={[Math.max(numValue, min)]}
        onValueChange={(val) => {
          const v = Array.isArray(val) ? val[0] : val;
          if (v !== undefined) {
            setValue(
              "duration",
              String(v) as GeneratorFormValues["duration"],
            );
          }
        }}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}s</span>
        <span>15s</span>
      </div>
    </div>
  );
}
