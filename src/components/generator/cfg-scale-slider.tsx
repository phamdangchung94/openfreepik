"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function CfgScaleSlider() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("cfg_scale") ?? 0.5;

  const hint =
    current < 0.3
      ? "Creative"
      : current > 0.7
        ? "Strict"
        : "Balanced";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>CFG Scale</Label>
        <Tooltip>
          <TooltipTrigger className="cursor-help">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            Controls how closely the model follows your prompt.
            0 = maximum creativity, 1 = strict adherence.
          </TooltipContent>
        </Tooltip>
        <span className="ml-auto text-sm font-medium tabular-nums">
          {current.toFixed(2)} <span className="text-muted-foreground">({hint})</span>
        </span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={[current]}
        onValueChange={(val) => {
          const v = Array.isArray(val) ? val[0] : val;
          if (v !== undefined) {
            setValue("cfg_scale", Math.round((v as number) * 100) / 100);
          }
        }}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Creative</span>
        <span>Strict</span>
      </div>
    </div>
  );
}
