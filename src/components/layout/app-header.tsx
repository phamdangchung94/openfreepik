"use client";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ActivationCodeInput } from "@/components/layout/activation-code-input";
import { AutoDownloadToggle } from "@/components/layout/auto-download-toggle";
import { KlingLogo } from "@/components/kling-logo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-4">
          <KlingLogo size={28} />
          <h1 className="text-lg font-semibold tracking-tight">
            Kling 3 Video Generator
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <ActivationCodeInput />
          <AutoDownloadToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
