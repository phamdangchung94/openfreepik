"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const VALUES = [
  "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
] as const;

/**
 * 3-15s integer picker for Kling Omni. Magnific API expects string
 * enum; client passes through verbatim.
 */
export function OmniDurationPicker() {
  const { watch, setValue, register } = useFormContext<GeneratorFormValues>();
  const current = watch("omni_duration");
  // Register so RHF tracks updates; native select fits the discrete set.
  register("omni_duration");
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Thời lượng (giây)</Label>
      <select
        value={current}
        onChange={(e) =>
          setValue(
            "omni_duration",
            e.target.value as (typeof VALUES)[number],
            { shouldDirty: true },
          )
        }
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        {VALUES.map((v) => (
          <option key={v} value={v}>
            {v}s
          </option>
        ))}
      </select>
    </div>
  );
}
