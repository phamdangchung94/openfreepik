"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatVnd } from "@/lib/format-currency";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Kling Motion Control tier picker — flat 4-button row (anh chose
 * over 2-level version→tier nested picker).
 *
 * Maps directly to the URL dynamic segment on /api/freepik/kling-motion/
 * [tier], which drives:
 *   - Magnific endpoint URL (via kling-motion ENDPOINT_MAP)
 *   - pricing_rules row lookup (endpoint = `kling-motion-${tier}`)
 *
 * "Std" tier is roughly half the price of Pro per the seeded rates.
 * v3 is ~2× the v2-6 Std rate but only 1.33× of v3 Pro vs Std — the
 * cost-preview shows the actual cost before submit.
 *
 * Per-second rate shown in VND (formatVnd handles the EUR→VND
 * conversion at the fixed display rate) so customers see the same
 * currency they're charged in. Rate per second is precise enough to
 * round in VND without losing precision: 0.059 EUR → 59 đ/s.
 */
const OPTIONS = [
  { id: "v2-6-std" as const, label: "2.6 Std", rateEurPerSec: 0.1386 },
  { id: "v2-6-pro" as const, label: "2.6 Pro", rateEurPerSec: 0.2761 },
  { id: "v3-std" as const, label: "3.0 Std", rateEurPerSec: 0.2948 },
  { id: "v3-pro" as const, label: "3.0 Pro", rateEurPerSec: 0.3938 },
];

export function MotionTierPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const tier = watch("motion_tier");

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Phiên bản / Chất lượng</Label>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.id}
            type="button"
            variant={tier === opt.id ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setValue("motion_tier", opt.id, { shouldDirty: true })
            }
            className="h-auto flex-col py-1.5"
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-[10px] opacity-70">
              {formatVnd(opt.rateEurPerSec)}/s
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
