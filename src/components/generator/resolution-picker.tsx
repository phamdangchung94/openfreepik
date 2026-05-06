"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const OPTIONS = [
  { id: "720P" as const, label: "720P", sub: "1280×720" },
  { id: "1080P" as const, label: "1080P", sub: "1920×1080" },
];

/**
 * WAN 2.7 resolution picker. Shown only when model="wan-v27" — Kling
 * uses the aspect-ratio + tier pickers instead. Maps directly to the
 * Magnific `resolution` request param ("720P" | "1080P").
 *
 * Resolution is the only quality lever WAN exposes (no Pro/Std tiers),
 * so this is also what drives pricing — see lookupForWanV27 in the
 * pricing calculator (std=720P, pro=1080P).
 */
export function ResolutionPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const resolution = watch("resolution");

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Độ phân giải</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.id}
            type="button"
            variant={resolution === opt.id ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setValue("resolution", opt.id, { shouldDirty: true })
            }
            className="h-auto flex-col py-1.5"
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-[10px] opacity-70">{opt.sub}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
