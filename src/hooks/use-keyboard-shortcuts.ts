"use client";

import { useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  onGenerate?: () => void;
  onImprovePrompt?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onGenerate,
  onImprovePrompt,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const target = e.target as HTMLElement;
      const inTextarea = target.tagName === "TEXTAREA";

      if (e.key === "Enter" && onGenerate) {
        e.preventDefault();
        onGenerate();
        return;
      }

      if (e.key === "i" && onImprovePrompt && !inTextarea) {
        e.preventDefault();
        onImprovePrompt();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, onGenerate, onImprovePrompt]);
}
