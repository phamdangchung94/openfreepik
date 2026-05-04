"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, ListPlus, Type } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchSettings } from "./batch-settings";
import { BatchExcelImport } from "./batch-excel-import";
import type { BatchItem } from "@/lib/form/generator-schema";

const MAX_PROMPTS = 100;

interface BatchT2VInputProps {
  /** Raw textarea content (one prompt per line). */
  value: string;
  onChange: (value: string) => void;
  /** Notified whenever the parsed item list changes. */
  onItemsChange: (items: BatchItem[]) => void;
}

type Mode = "paste" | "excel";

export function BatchT2VInput({
  value,
  onChange,
  onItemsChange,
}: BatchT2VInputProps) {
  const [mode, setMode] = useState<Mode>("paste");

  // Switching tabs clears the items so the customer doesn't accidentally
  // submit prompts from the inactive tab. Each tab owns its own state
  // (the textarea via `value` prop, the Excel parser internally).
  function handleModeChange(next: string) {
    if (next !== mode) {
      onItemsChange([]);
      setMode(next as Mode);
    }
  }

  return (
    <Tabs value={mode} onValueChange={handleModeChange} className="space-y-3">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="paste" className="gap-1.5">
          <Type className="size-3.5" />
          Dán prompt
        </TabsTrigger>
        <TabsTrigger value="excel" className="gap-1.5">
          <FileSpreadsheet className="size-3.5" />
          Tải Excel/CSV
        </TabsTrigger>
      </TabsList>

      <TabsContent value="paste" className="m-0">
        <PasteMode
          value={value}
          onChange={onChange}
          onItemsChange={onItemsChange}
        />
      </TabsContent>

      <TabsContent value="excel" className="m-0">
        <BatchExcelImport onItemsChange={onItemsChange} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Original textarea-based "one prompt per line" input — extracted so the
 * tab system can mount/unmount it without losing keystrokes mid-typing.
 */
function PasteMode({
  value,
  onChange,
  onItemsChange,
}: BatchT2VInputProps) {
  const items = useMemo(() => parsePrompts(value), [value]);

  function handleChange(next: string) {
    onChange(next);
    onItemsChange(parsePrompts(next));
  }

  const overLimit = items.length > MAX_PROMPTS;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListPlus className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Danh sách prompt</span>
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
        placeholder={`Dán tối đa ${MAX_PROMPTS} prompt — mỗi dòng một prompt.\n\ncảnh điện ảnh một con mèo đi qua con hẻm đầy đèn neon\ngóc nhìn flycam thung lũng núi sương mù lúc bình minh\n…`}
        rows={10}
        className="font-mono text-xs min-h-[200px]"
        spellCheck={false}
      />
      {overLimit && (
        <p className="text-xs text-destructive">
          Quá nhiều prompt — giữ dưới {MAX_PROMPTS}. Các dòng dư sẽ bị bỏ qua.
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Mỗi dòng tạo một video — cài đặt bên dưới áp dụng cho tất cả.
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
