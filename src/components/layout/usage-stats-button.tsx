"use client";

import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth-store";
import { UsagePanel } from "@/components/usage/usage-panel";

/**
 * Header-level "Thống kê" button. Mounts the existing UsagePanel
 * dialog but with an obvious icon-and-label trigger instead of the
 * old hidden-in-the-balance-text click target.
 *
 * Hidden when the customer hasn't activated a code yet — the panel
 * has nothing to show without auth, and the button would just produce
 * a 401 spinner.
 */
export function UsageStatsButton() {
  const activated = useAuthStore((s) => Boolean(s.activationCode));
  if (!activated) return null;

  return (
    <UsagePanel
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          title="Mở thống kê sử dụng"
        >
          <BarChart3 className="size-3.5" />
          <span className="hidden sm:inline">Thống kê</span>
        </Button>
      }
    />
  );
}
