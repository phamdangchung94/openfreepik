"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Header button — direct link to Telegram support (t.me/chugaxai).
 * 1-tap to reach support; no intermediate dropdown to slow the
 * customer down when they need help. Renders as <a> via Next/Link so
 * it's keyboard- and tab-navigable and opens in a new tab.
 *
 * Why Telegram (not Zalo): admin chose Telegram as primary support
 * channel. Zalo still reachable from the onboarding card for users
 * who prefer it.
 */
export function ContactButton() {
  return (
    <Link
      href="https://t.me/chugaxai"
      target="_blank"
      rel="noreferrer"
      aria-label="Chat với hỗ trợ qua Telegram"
      title="Hỗ trợ Telegram @chugaxai"
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "size-9 sm:size-8 [&_svg]:size-4",
      )}
    >
      <Send />
    </Link>
  );
}
