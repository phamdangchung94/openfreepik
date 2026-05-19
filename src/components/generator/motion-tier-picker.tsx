"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
 * cost-preview shows the actual EUR before submit.
 */
const OPTIONS = [
  { id: "v2-6-std" as const, label: "2.6 Std", sub: "€0.059/s" },
  { id: "v2-6-pro" as const, label: "2.6 Pro", sub: "€0.118/s" },
  { id: "v3-std" as const, label: "3.0 Std", sub: "€0.126/s" },
  { id: "v3-pro" as const, label: "3.0 Pro", sub: "€0.168/s" },
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
            <span className="text-[10px] opacity-70">{opt.sub}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
