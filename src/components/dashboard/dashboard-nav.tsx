"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  KeyRound,
  Server,
  Tag,
  Activity,
  Megaphone,
  Wallet,
  Code2,
  Ticket,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// `label` = original desktop sidebar text (kept exactly as it was so
// the desktop UX doesn't shift). `shortLabel` = mobile-only tab text,
// abbreviated to fit a 5-column bottom bar on 375px viewports.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", shortLabel: "Tổng", icon: Home, exact: true },
  { href: "/dashboard/codes", label: "Codes", shortLabel: "Codes", icon: KeyRound, exact: false },
  { href: "/dashboard/vouchers", label: "Vouchers", shortLabel: "Nạp", icon: Ticket, exact: false },
  { href: "/dashboard/keys", label: "API keys", shortLabel: "Keys", icon: Server, exact: false },
  { href: "/dashboard/pricing", label: "Pricing", shortLabel: "Giá", icon: Tag, exact: false },
  { href: "/dashboard/usage", label: "Usage logs", shortLabel: "Log", icon: Activity, exact: false },
  { href: "/dashboard/costs", label: "Costs", shortLabel: "Chi phí", icon: Wallet, exact: false },
  { href: "/dashboard/announcements", label: "Announcements", shortLabel: "Tin", icon: Megaphone, exact: false },
  { href: "/dashboard/api-keys", label: "API tokens", shortLabel: "Token", icon: Code2, exact: false },
] as const;

/**
 * Two-mode nav (mobile-first redesign 2026-05-13):
 *
 *   - md+ (≥768px): fixed-width sidebar, identical to the desktop UX
 *     the admin is used to. Unchanged behavior.
 *   - <md: thin top bar (page title + sign-out) + sticky BOTTOM tab
 *     bar with 5 thumb-reachable icons. One-tap section switching,
 *     no hamburger drawer to wrangle.
 *
 * The bottom tab pattern matches native iOS/Android admin apps and
 * keeps both hands free; the previous hamburger required two taps
 * per nav and crowded the top bar.
 *
 * Safe-area handling: `pb-[env(safe-area-inset-bottom)]` ensures
 * the tab row clears the iOS home indicator. Layout sets
 * `pb-20 md:pb-0` on the main content so nothing hides under the bar.
 */
export function DashboardNav() {
  const pathname = usePathname();

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
      <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-card/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">
            {activeItem?.label ?? "Admin"}
          </p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            Admin console
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

      {/* ── Mobile bottom tab bar (under md) ──────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Bottom navigation"
      >
        <div className="grid grid-cols-5">
          {NAV_ITEMS.map(({ href, shortLabel, icon: Icon, exact }) => {
            const active = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 transition-transform",
                    active && "scale-110",
                  )}
                />
                <span>{shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Desktop sidebar (md+) — UNCHANGED from prior layout ── */}
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
