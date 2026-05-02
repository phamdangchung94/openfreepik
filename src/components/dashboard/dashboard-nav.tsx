"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  KeyRound,
  Server,
  Tag,
  Activity,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: Home, exact: true },
  { href: "/dashboard/codes", label: "Codes", icon: KeyRound, exact: false },
  { href: "/dashboard/keys", label: "Freepik keys", icon: Server, exact: false },
  { href: "/dashboard/pricing", label: "Pricing", icon: Tag, exact: false },
  { href: "/dashboard/usage", label: "Usage logs", icon: Activity, exact: false },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/dashboard/login";
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r bg-card">
      <div className="border-b px-4 py-4">
        <h1 className="text-sm font-semibold">OpenFreepik Admin</h1>
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
  );
}
