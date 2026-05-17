"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { ActivationCodeInput } from "@/components/layout/activation-code-input";
import { AutoDownloadToggle } from "@/components/layout/auto-download-toggle";
import { UsageStatsButton } from "@/components/layout/usage-stats-button";
import { ErrorLogButton } from "@/components/error-log/error-log-button";
import { ContactButton } from "@/components/layout/contact-button";
import { KlingLogo } from "@/components/kling-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between gap-3 px-3 md:px-6">
        <div className="flex shrink-0 items-center gap-3 md:gap-4">
          <Link href="/" className="flex items-center gap-3 md:gap-4">
            <KlingLogo size={28} />
            {/* Title hidden on small mobile to free space for the activation input. */}
            <h1 className="hidden text-base font-semibold tracking-tight sm:inline md:text-lg">
              Kling 3 Video Generator
            </h1>
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          {/* Customer-facing pricing — read-only, no auth required. */}
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "gap-1.5",
            )}
          >
            <Coins className="size-3.5" />
            <span className="hidden sm:inline">Bảng giá</span>
          </Link>
          <ContactButton />
          <ErrorLogButton />
          <UsageStatsButton />
          <ActivationCodeInput />
          <AutoDownloadToggle />
        </div>
      </div>
    </header>
  );
}
