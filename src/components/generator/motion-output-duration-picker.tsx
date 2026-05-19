"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Output-duration picker for Kling Motion. 4 fixed values matching
 * the seeded pricing_rules rows: 5s / 10s / 15s / 30s.
 *
 * 15s + 30s are only valid when `motion_orientation === "video"`. We
 * grey out (disable) the two longer options when orientation=image so
 * the customer sees the cap visibly instead of getting a form error
 * later. Schema's superRefine is the authoritative gate.
 */
const OPTIONS = [
  { id: "5" as const, label: "5s" },
  { id: "10" as const, label: "10s" },
  { id: "15" as const, label: "15s", videoOnly: true },
  { id: "30" as const, label: "30s", videoOnly: true },
];

export function MotionOutputDurationPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const duration = watch("output_duration");
  const orientation = watch("motion_orientation");
  const isImageMode = orientation === "image";

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Thời lượng output</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {OPTIONS.map((opt) => {
          const disabled = isImageMode && opt.videoOnly;
          return (
            <Button
              key={opt.id}
              type="button"
              variant={duration === opt.id ? "default" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() =>
                setValue("output_duration", opt.id, { shouldDirty: true })
              }
              className="h-auto py-1.5"
              title={
                disabled
                  ? "Chỉ khả dụng khi 'Khung hình theo' = Video"
                  : undefined
              }
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
