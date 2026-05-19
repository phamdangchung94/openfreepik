"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Character-orientation toggle for Kling Motion. Drives the upstream
 * `character_orientation` request param AND the allowed output
 * duration ceiling:
 *   - "video" (default) — output up to 30s, follows motion video's
 *     spatial framing. Better for complex motions.
 *   - "image"           — output up to 10s, follows the character
 *     image's framing. Better for camera-follow shots on the character.
 *
 * Switching to "image" while output_duration is 15/30 leaves form in
 * a soft-error state — the schema's superRefine catches it; we don't
 * auto-correct here so the customer notices the change.
 */
const OPTIONS = [
  { id: "video" as const, label: "Theo Video", sub: "Tối đa 30s output" },
  { id: "image" as const, label: "Theo Ảnh", sub: "Tối đa 10s output" },
];

export function MotionOrientationToggle() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const orientation = watch("motion_orientation");

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Khung hình theo</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.id}
            type="button"
            variant={orientation === opt.id ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setValue("motion_orientation", opt.id, { shouldDirty: true })
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
