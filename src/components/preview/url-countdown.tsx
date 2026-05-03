"use client";

import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface UrlCountdownProps {
  /** Epoch ms when the URL is expected to stop working. */
  expiresAt: number | null;
  /** Compact rendering (no icon, smaller text) — used in the history list. */
  compact?: boolean;
  className?: string;
}

/**
 * Live countdown until a video URL expires. Updates every minute (or every
 * second in the last 5 minutes for visible urgency). Returns null when
 * expiresAt is missing — old completed tasks may not have it.
 *
 * Status thresholds:
 *   > 6h        normal (muted)
 *   1h–6h       warning (amber)
 *   < 1h        critical (red, blinking)
 *   expired     destructive ("Hết hạn")
 */
export function UrlCountdown({ expiresAt, compact, className }: UrlCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const remaining = expiresAt - now;
    // Tick every second under 5 min so the user sees the timer move; every
    // minute otherwise (cheap setInterval, no perf concern).
    const interval = remaining > 5 * 60_000 ? 60_000 : 1_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [expiresAt, now]);

  if (!expiresAt) return null;

  const remainingMs = expiresAt - now;
  const expired = remainingMs <= 0;
  const critical = !expired && remainingMs < 60 * 60_000; // < 1h
  const warning = !expired && !critical && remainingMs < 6 * 60 * 60_000;

  const colorClass = expired
    ? "text-destructive"
    : critical
      ? "text-destructive animate-pulse"
      : warning
        ? "text-amber-500"
        : "text-muted-foreground";

  const Icon = expired || critical ? AlertTriangle : Clock;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono",
        compact ? "text-[10px]" : "text-xs",
        colorClass,
        className,
      )}
      title={
        expired
          ? "Link đã hết hạn — không thể tải lại"
          : `Hết hạn lúc ${new Date(expiresAt).toLocaleString()}`
      }
    >
      {!compact && <Icon className={compact ? "size-3" : "size-3.5"} />}
      {expired ? "Hết hạn" : `Còn ${formatRemaining(remainingMs)}`}
    </span>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
