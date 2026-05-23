"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Mintlify-style sticky sidebar navigation for the docs page.
 *
 * Active section detection uses an IntersectionObserver attached to
 * every `[id]` element with `data-section`. Whichever section is most
 * visible in the viewport gets highlighted. Smooth scrolling on click.
 *
 * Desktop only — mobile users get the section list collapsed at the
 * top of the content area via <MobileSectionMenu>.
 */

export interface NavItem {
  anchor: string;
  label: string;
  method?: "GET" | "POST";
  group?: string;
}

interface SidebarNavProps {
  items: readonly NavItem[];
}

export function SidebarNav({ items }: SidebarNavProps) {
  const [active, setActive] = useState<string>(items[0]?.anchor ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost visible entry — `isIntersecting` alone fires
        // for every section on the page so we'd flicker between them.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0];
        if (top?.target?.id) setActive(top.target.id);
      },
      // rootMargin pushes the "active" zone down ~30% from the top so a
      // section becomes active when its top half is visible, not when
      // its very first pixel scrolls in.
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.1, 0.5] },
    );

    for (const item of items) {
      const el = document.getElementById(item.anchor);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  // Group items by their `group` field (preserving order of first occurrence).
  const groups: { name: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const groupName = item.group ?? "Endpoints";
    let g = groups.find((x) => x.name === groupName);
    if (!g) {
      g = { name: groupName, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  return (
    <nav className="sticky top-4 hidden h-fit max-h-[calc(100vh-2rem)] w-56 shrink-0 overflow-y-auto pr-2 md:block">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        API Reference
      </p>
      {groups.map((g) => (
        <div key={g.name} className="mb-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {g.name}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.anchor}>
                <a
                  href={`#${item.anchor}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                    active === item.anchor
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {item.method && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 font-mono text-[8px] font-semibold",
                        item.method === "POST"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                      )}
                    >
                      {item.method}
                    </span>
                  )}
                  <span className="truncate">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Compact mobile section menu — collapsed by default, expands on tap.
 * Lives at the top of the content area on small viewports where the
 * full sticky sidebar is hidden.
 */
export function MobileSectionMenu({ items }: SidebarNavProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium"
      >
        <span>Mục lục API</span>
        <span className="text-xs text-muted-foreground">{open ? "Đóng" : "Mở"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-0.5 rounded-md border bg-background p-2">
          {items.map((item) => (
            <li key={item.anchor}>
              <a
                href={`#${item.anchor}`}
                onClick={() => setOpen(false)}
                className="block rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                {item.method && (
                  <span
                    className={cn(
                      "mr-1.5 inline-block rounded px-1 py-0.5 font-mono text-[8px] font-semibold",
                      item.method === "POST"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-blue-500/10 text-blue-700",
                    )}
                  >
                    {item.method}
                  </span>
                )}
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
