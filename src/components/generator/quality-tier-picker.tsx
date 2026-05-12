"use client";

import { useFormContext } from "react-hook-form";
import { Crown, Gem, Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Three Kling 3 quality tiers. '4k' is exposed to customers here but
 * actually dispatches to Magnific's separate kling-4k-* endpoints; the
 * routing branch lives in use-generate-video / use-batch-queue.
 */
const TIERS = [
  {
    value: "4k" as const,
    label: "4K",
    desc: "Native 4K",
    icon: Gem,
  },
  {
    value: "pro" as const,
    label: "1080p",
    desc: "Pro",
    icon: Crown,
  },
  {
    value: "std" as const,
    label: "720p",
    desc: "Tiết kiệm",
    icon: Zap,
  },
];

export function QualityTierPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("tier");

  return (
    <div className="space-y-2">
      <Label>Chất lượng</Label>
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map(({ value, label, desc, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            className={cn(
              "flex h-auto min-w-0 flex-col items-start gap-0.5 overflow-hidden px-2.5 py-2.5",
              current === value && "border-primary bg-primary/5 ring-1 ring-primary"
            )}
            onClick={() => setValue("tier", value)}
          >
            <div className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </div>
            <span className="w-full truncate text-xs text-muted-foreground">
              {desc}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
