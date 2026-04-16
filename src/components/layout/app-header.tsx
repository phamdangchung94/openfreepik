"use client";

import { Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ApiKeyInput } from "@/components/layout/api-key-input";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <Video className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">
            Kling 3 Video Generator
          </h1>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            Freepik API
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <ApiKeyInput />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
