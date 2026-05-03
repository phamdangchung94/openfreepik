"use client";

import { useMemo } from "react";
import { ListPlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BatchSettings } from "./batch-settings";
import type { BatchItem } from "@/lib/form/generator-schema";

const MAX_PROMPTS = 100;

interface BatchT2VInputProps {
  /** Raw textarea content (one prompt per line). */
  value: string;
  onChange: (value: string) => void;
  /** Notified whenever the parsed item list changes. */
  onItemsChange: (items: BatchItem[]) => void;
}

export function BatchT2VInput({
  value,
  onChange,
  onItemsChange,
}: BatchT2VInputProps) {
  const items = useMemo(() => parsePrompts(value), [value]);

  // Push parsed items up so the form/queue see them.
  // useMemo above is pure; the side-effect lives in the change handler.
  function handleChange(next: string) {
    onChange(next);
    onItemsChange(parsePrompts(next));
  }

  const overLimit = items.length > MAX_PROMPTS;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListPlus className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Batch prompts</span>
        <Badge
          variant={overLimit ? "destructive" : "secondary"}
          className="ml-auto text-[10px]"
        >
          {items.length} / {MAX_PROMPTS}
        </Badge>
      </div>
      <Textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Paste up to ${MAX_PROMPTS} prompts — one per line.\n\na cinematic shot of a cat walking through a neon-lit alley\na drone view of a misty mountain valley at dawn\n…`}
        rows={10}
        className="font-mono text-xs min-h-[200px]"
        spellCheck={false}
      />
      {overLimit && (
        <p className="text-xs text-destructive">
          Too many prompts — keep it under {MAX_PROMPTS}. Extra lines will be
          ignored.
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Each line generates one video — settings below apply to all.
          </span>
          <BatchSettings />
        </div>
      )}
    </div>
  );
}

/** Split textarea content into trimmed, non-empty prompts (capped). */
function parsePrompts(raw: string): BatchItem[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_PROMPTS);

  return lines.map((prompt) => ({
    id: prompt + "::" + Math.random().toString(36).slice(2, 8),
    mode: "t2v" as const,
    prompt,
  }));
}
