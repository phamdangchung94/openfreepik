"use client";

import { ActivationCodeInput } from "@/components/layout/activation-code-input";
import { AutoDownloadToggle } from "@/components/layout/auto-download-toggle";
import { UsageStatsButton } from "@/components/layout/usage-stats-button";
import { KlingLogo } from "@/components/kling-logo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between gap-3 px-3 md:px-6">
        <div className="flex shrink-0 items-center gap-3 md:gap-4">
          <KlingLogo size={28} />
          {/* Title hidden on small mobile to free space for the activation input. */}
          <h1 className="hidden text-base font-semibold tracking-tight sm:inline md:text-lg">
            Kling 3 Video Generator
          </h1>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <UsageStatsButton />
          <ActivationCodeInput />
          <AutoDownloadToggle />
        </div>
      </div>
    </header>
  );
}
