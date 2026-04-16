"use client";

import { useTaskStore } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";

const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10] as const;

export function BatchSettings() {
  const concurrency = useTaskStore((s) => s.concurrency);
  const setConcurrency = useTaskStore((s) => s.setConcurrency);
  const autoEnhance = useTaskStore((s) => s.autoEnhance);
  const setAutoEnhance = useTaskStore((s) => s.setAutoEnhance);

  return (
    <div className="w-full space-y-3">
      {/* Concurrency */}
      <div className="flex items-center gap-3">
        <Label className="text-xs text-muted-foreground shrink-0">
          Concurrency
        </Label>
        <div className="flex gap-1">
          {CONCURRENCY_OPTIONS.map((n) => (
            <Button
              key={n}
              type="button"
              variant={concurrency === n ? "default" : "outline"}
              size="xs"
              className="w-7"
              onClick={() => setConcurrency(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>

      {/* Auto-enhance prompts */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <Label
            htmlFor="auto-enhance"
            className="text-xs cursor-pointer"
          >
            Auto-enhance prompts
          </Label>
        </div>
        <Switch
          id="auto-enhance"
          checked={autoEnhance}
          onCheckedChange={setAutoEnhance}
        />
      </div>
    </div>
  );
}
