"use client";

import { useFormContext } from "react-hook-form";
import { Type, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MODES = [
  { value: "t2v" as const, label: "Text to Video", icon: Type },
  { value: "i2v" as const, label: "Image to Video", icon: Image },
];

interface ModeToggleProps {
  /** Fires after the form mode changes — parent can clear batch state, etc. */
  onModeChange?: (mode: "t2v" | "i2v") => void;
}

export function ModeToggle({ onModeChange }: ModeToggleProps = {}) {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const current = watch("mode");

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {MODES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "flex-1 gap-2",
            current === value && "bg-background shadow-sm",
          )}
          onClick={() => {
            if (current === value) return;
            setValue("mode", value, { shouldValidate: true });
            onModeChange?.(value);
          }}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      ))}
    </div>
  );
}
