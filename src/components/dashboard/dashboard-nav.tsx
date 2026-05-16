"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  KeyRound,
  Server,
  Tag,
  Activity,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: Home, exact: true },
  { href: "/dashboard/codes", label: "Codes", icon: KeyRound, exact: false },
  { href: "/dashboard/keys", label: "API keys", icon: Server, exact: false },
  { href: "/dashboard/pricing", label: "Pricing", icon: Tag, exact: false },
  { href: "/dashboard/usage", label: "Usage logs", icon: Activity, exact: false },
] as const;

/**
 * Two-mode nav:
 *   - md+ (≥768px): fixed-width sidebar always visible
 *   - <md: top bar with hamburger trigger + slide-down panel
 *
 * The mobile panel uses a controlled state instead of a base-ui sheet
 * primitive so we can position it inline below the bar (full-width
 * dropdown) — sheets default to side-mounted which feels heavy on a
 * 375px phone. Closing on link click is the key UX detail.
 */
export function DashboardNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/dashboard/login";
  }

  const activeItem = NAV_ITEMS.find((item) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/"),
  );

  return (
    <>
      {/* ── Mobile top bar (under md) ──────────────────────────── */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-card/95 px-3 py-2 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="-ml-1 inline-flex size-9 items-center justify-center rounded-md text-foreground hover:bg-muted"
          aria-label={mobileOpen ? "Đóng menu" : "Mở menu"}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold">
            {activeItem?.label ?? "Admin"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleLogout}
          aria-label="Đăng xuất"
          className="text-muted-foreground"
        >
          <LogOut className="size-4" />
        </Button>
      </div>

      {/* ── Mobile drawer (under md) ──────────────────────────── */}
      {mobileOpen && (
        <>
          {/* Backdrop — click anywhere to close */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-x-0 top-[49px] bottom-0 z-20 bg-black/30 backdrop-blur-sm md:hidden"
          />
          <nav
            className="fixed inset-x-0 top-[49px] z-30 border-b bg-card shadow-lg md:hidden"
            aria-label="Mobile navigation"
          >
            <div className="space-y-0.5 p-2">
              {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
                const active = exact
                  ? pathname === href
                  : pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}

      {/* ── Desktop sidebar (md+) ──────────────────────────── */}
      <aside className="hidden h-screen w-56 shrink-0 flex-col border-r bg-card md:flex">
        <div className="border-b px-4 py-4">
          <h1 className="text-sm font-semibold">Admin Console</h1>
          <p className="text-[11px] text-muted-foreground">Dashboard</p>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={handleLogout}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </aside>
    </>
  );
}
