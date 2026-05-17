"use client";

import { MessageCircle, ArrowUpRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * Header button — opens a dropdown with Telegram + Zalo support links.
 * Lives in the customer-facing AppHeader so help is always one tap
 * away regardless of where the user is on the page.
 */
export function ContactButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Liên hệ hỗ trợ"
            className="size-9 sm:size-8 [&_svg]:size-4"
            title="Liên hệ hỗ trợ"
          >
            <MessageCircle />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Hỗ trợ khách hàng
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <a
          href="https://t.me/chugaxai"
          target="_blank"
          rel="noreferrer"
          // Manual <a> instead of DropdownMenuItem so target=_blank +
          // ArrowUpRight render cleanly. Same focus/hover styles as
          // DropdownMenuItem via the className below.
          className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        >
          <span className="font-medium text-[#229ED9]">Telegram</span>
          <span className="text-xs text-muted-foreground">@chugaxai</span>
          <ArrowUpRight className="ml-auto size-3 text-muted-foreground" />
        </a>
        <a
          href="https://zalo.me/0336788856"
          target="_blank"
          rel="noreferrer"
          className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        >
          <span className="font-medium text-[#0068FF]">Zalo</span>
          <span className="text-xs text-muted-foreground">0336788856</span>
          <ArrowUpRight className="ml-auto size-3 text-muted-foreground" />
        </a>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
