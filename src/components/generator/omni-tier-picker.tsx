"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatVnd } from "@/lib/format-currency";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * 2-button tier picker for Kling Omni. Rate labels reflect the retail
 * EUR/s from pricing_rules (kling-omni-{tier}-video with/without audio).
 * Audio toggle is separate — these are no-audio base rates; with-audio
 * variant costs ~1.83x.
 */
const OPTIONS = [
  { id: "std" as const, label: "Standard", rateEurPerSec: 0.168 },
  { id: "pro" as const, label: "Pro", rateEurPerSec: 0.224 },
];

export function OmniTierPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("omni_tier");

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Chất lượng</Label>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() =>
              setValue("omni_tier", opt.id, { shouldDirty: true })
            }
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md border p-2.5 transition-colors",
              current === opt.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-foreground/30 hover:bg-muted/40",
            )}
            aria-pressed={current === opt.id}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatVnd(opt.rateEurPerSec)}/s
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
