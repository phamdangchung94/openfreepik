"use client";

import { useFormContext } from "react-hook-form";
import { Crown, Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const TIERS = [
  {
    value: "pro" as const,
    label: "Pro",
    desc: "Higher fidelity",
    icon: Crown,
  },
  {
    value: "std" as const,
    label: "Standard",
    desc: "Faster & cheaper",
    icon: Zap,
  },
];

export function QualityTierPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("tier");

  return (
    <div className="space-y-2">
      <Label>Quality Tier</Label>
      <div className="grid grid-cols-2 gap-2">
        {TIERS.map(({ value, label, desc, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            className={cn(
              "flex h-auto flex-col items-start gap-0.5 px-3 py-2.5",
              current === value && "border-primary bg-primary/5 ring-1 ring-primary"
            )}
            onClick={() => setValue("tier", value)}
          >
            <div className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span className="text-sm font-medium">{label}</span>
            </div>
            <span className="text-xs text-muted-foreground">{desc}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
