"use client";

import { useState, useEffect } from "react";
import { Key, Eye, EyeOff, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTaskStore } from "@/store/task-store";

export function ApiKeyInput() {
  const apiKey = useTaskStore((s) => s.apiKey);
  const setApiKey = useTaskStore((s) => s.setApiKey);
  const [visible, setVisible] = useState(false);
  const [localValue, setLocalValue] = useState(apiKey);

  // Sync localValue when store hydrates from localStorage
  useEffect(() => {
    setLocalValue(apiKey);
  }, [apiKey]);

  const hasKey = apiKey.length > 0;
  const isDirty = localValue !== apiKey;

  function handleSave() {
    const trimmed = localValue.trim();
    if (trimmed !== apiKey) {
      setApiKey(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSave();
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Key className={`h-4 w-4 shrink-0 ${hasKey ? "text-green-500" : "text-amber-500"}`} />
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          placeholder="Enter Freepik API Key"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className={`h-8 w-[220px] pr-8 text-xs font-mono ${!hasKey ? "border-amber-500/50" : ""}`}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
      {isDirty && (
        <Button variant="ghost" size="xs" onClick={handleSave}>
          <Check className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
