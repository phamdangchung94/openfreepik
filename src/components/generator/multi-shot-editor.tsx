"use client";

import { useFormContext, useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function MultiShotEditor() {
  const { control, register, watch } = useFormContext<GeneratorFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "multi_prompt",
  });

  const shots = watch("multi_prompt") ?? [];
  const totalDuration = shots.reduce(
    (sum, s) => sum + parseInt(s?.duration ?? "5", 10),
    0
  );
  const overCap = totalDuration > 15;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Scenes ({fields.length}/6)</Label>
        <Badge variant={overCap ? "destructive" : "secondary"}>
          {totalDuration}/15s
        </Badge>
      </div>

      <Progress
        value={Math.min((totalDuration / 15) * 100, 100)}
        className="h-1.5"
      />

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="flex gap-2 rounded-lg border bg-card p-3"
          >
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  Scene {index + 1}
                </Badge>
                <Select
                  defaultValue={shots[index]?.duration ?? "5"}
                  onValueChange={(v) => {
                    const arr = [...shots];
                    if (arr[index]) arr[index] = { ...arr[index], duration: v as GeneratorFormValues["duration"] };
                  }}
                >
                  <SelectTrigger className="h-7 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 13 }, (_, i) => i + 3).map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d}s
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                rows={2}
                placeholder={`Describe scene ${index + 1}...`}
                {...register(`multi_prompt.${index}.prompt`)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-1 shrink-0"
              onClick={() => remove(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={fields.length >= 6 || overCap}
        onClick={() => append({ prompt: "", duration: "5" })}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add Scene
      </Button>

      {overCap && (
        <p className="text-sm text-destructive">
          Total duration exceeds 15 seconds. Remove scenes or shorten durations.
        </p>
      )}
    </div>
  );
}
