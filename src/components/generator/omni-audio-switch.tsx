"use client";

import { useFormContext } from "react-hook-form";
import { Volume2, VolumeX } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Omni native audio toggle. Costs ~1.83x base when enabled (Magnific
 * audio variant). Customer sees pricing reflected in CostPreview.
 */
export function OmniAudioSwitch() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const enabled = watch("omni_audio");

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-0.5">
        <Label className="flex items-center gap-1.5 text-xs">
          {enabled ? (
            <Volume2 className="size-3.5" />
          ) : (
            <VolumeX className="size-3.5" />
          )}
          Tạo âm thanh tự nhiên
        </Label>
        <p className="text-[10px] text-muted-foreground">
          Omni tự sinh audio đồng bộ video. Bật giá ~1.83× cao hơn.
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          setValue("omni_audio", !enabled, { shouldDirty: true })
        }
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          enabled ? "bg-primary" : "bg-muted",
        )}
        aria-pressed={enabled}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-background transition-transform",
            enabled ? "left-4" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
