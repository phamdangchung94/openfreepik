"use client";

import { useEffect, useState } from "react";
import { Info, AlertTriangle, AlertOctagon, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Severity = "info" | "warn" | "critical";

interface Announcement {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  severity: Severity;
  createdAt: string;
  expiresAt: string | null;
}

const DISMISSED_KEY = "openfreepik-dismissed-announcements";

/**
 * Customer-facing announcement banner — sits at the top of the page,
 * below the AppHeader. Fetches from /api/announcements on mount, shows
 * the most recent active+non-expired announcement. Per-device dismiss
 * via localStorage (id-keyed) so dismissing on phone doesn't dismiss
 * on desktop — customer gets one chance to see the notice per device.
 *
 * Polls every 60s in background so an admin posting an urgent notice
 * reaches customers already on the page without requiring a reload.
 */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Hydrate dismissed set from localStorage. Wrapped in try to defend
    // against private-mode / quota errors.
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/announcements", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.ok) setItems(json.announcements as Announcement[]);
      } catch {
        // Silently fail — banner is non-critical, never block the page
        // even if the announcements endpoint is broken.
      }
    }
    load();
    // Poll every 60s so urgent broadcasts surface without a reload.
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort
      }
      return next;
    });
  }

  const visible = items.filter((i) => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  // Show only the newest one at a time to avoid stacking banners. Older
  // announcements still accessible via the persistent header item once
  // the newest is dismissed (queue plays through one at a time).
  const current = visible[0];
  if (!current) return null;

  return (
    <div className="border-b">
      <BannerRow item={current} onDismiss={() => dismiss(current.id)} />
    </div>
  );
}

function BannerRow({
  item,
  onDismiss,
}: {
  item: Announcement;
  onDismiss: () => void;
}) {
  const variant: Record<
    Severity,
    { bg: string; text: string; icon: React.ReactNode }
  > = {
    info: {
      bg: "bg-sky-500/10",
      text: "text-sky-900 dark:text-sky-100",
      icon: <Info className="size-4 text-sky-600 dark:text-sky-400" />,
    },
    warn: {
      bg: "bg-amber-500/10",
      text: "text-amber-900 dark:text-amber-100",
      icon: <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />,
    },
    critical: {
      bg: "bg-destructive/15",
      text: "text-destructive",
      icon: <AlertOctagon className="size-4 text-destructive" />,
    },
  };
  const v = variant[item.severity];
  return (
    <div className={cn("w-full", v.bg)}>
      <div className="mx-auto flex max-w-[1600px] items-start gap-3 px-4 py-2.5 text-xs sm:text-sm">
        <span className="mt-0.5 shrink-0">{v.icon}</span>
        <div className={cn("min-w-0 flex-1 space-y-0.5", v.text)}>
          <p className="font-semibold leading-tight">{item.title}</p>
          <p className="whitespace-pre-wrap break-words text-[11px] leading-snug opacity-90 sm:text-xs">
            {item.body}
          </p>
          {item.ctaLabel && item.ctaUrl && (
            <a
              href={item.ctaUrl}
              target={item.ctaUrl.startsWith("http") ? "_blank" : undefined}
              rel={item.ctaUrl.startsWith("http") ? "noreferrer" : undefined}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline sm:text-xs"
            >
              {item.ctaLabel} <ArrowRight className="size-3" />
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Ẩn thông báo"
          className={cn(
            "-mr-1 shrink-0 rounded p-1 transition-opacity hover:bg-black/5 dark:hover:bg-white/10",
            v.text,
          )}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
