"use client";

import { useFormContext, Controller } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function GenerateAudioSwitch() {
  const { control } = useFormContext<GeneratorFormValues>();

  return (
    <div className="flex items-center justify-between">
      <Label htmlFor="generate_audio" className="cursor-pointer">
        Generate Audio
      </Label>
      <Controller
        control={control}
        name="generate_audio"
        render={({ field }) => (
          <Switch
            id="generate_audio"
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
    </div>
  );
}
