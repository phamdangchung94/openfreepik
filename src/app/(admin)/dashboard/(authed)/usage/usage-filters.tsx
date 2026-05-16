"use client";

import { useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface UsageFilterValue {
  status: string;
  codeId: string;
  keyId: string;
  limit: number;
}

export const ALL = "__all__"; // sentinel for "no filter"

interface CodeOption {
  id: string;
  // /api/admin/codes returns customerLabel as `label` (alias in the
  // SELECT). Match that shape so dropdown labels populate correctly.
  label: string | null;
}

interface KeyOption {
  id: string;
  label: string;
  isActive: boolean;
}

/**
 * Three-dropdown filter bar plus a row-limit selector. Customer + key
 * options are fetched from /api/admin/codes and /api/admin/keys on
 * mount; admin can scope the table to one customer, one key, both, or
 * neither.
 */
export function UsageFilters({
  value,
  onChange,
}: {
  value: UsageFilterValue;
  onChange: (next: UsageFilterValue) => void;
}) {
  const [codes, setCodes] = useState<CodeOption[]>([]);
  const [keys, setKeys] = useState<KeyOption[]>([]);
  // Mobile-only collapse state. md+ ignores this and always renders
  // the filter row inline.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Count of non-default filters for the chip on the mobile toggle.
  const activeCount =
    (value.status !== ALL ? 1 : 0) +
    (value.codeId !== ALL ? 1 : 0) +
    (value.keyId !== ALL ? 1 : 0) +
    (value.limit !== 100 ? 1 : 0);

  useEffect(() => {
    async function load() {
      // Both endpoints already exist; failing silently here just leaves
      // the dropdowns empty rather than blocking the rest of the UI.
      try {
        const [cRes, kRes] = await Promise.all([
          fetch("/api/admin/codes?limit=200"),
          fetch("/api/admin/keys"),
        ]);
        const cJson = await cRes.json();
        const kJson = await kRes.json();
        if (cJson.ok) setCodes(cJson.codes ?? []);
        if (kJson.ok) setKeys(kJson.keys ?? []);
      } catch {
        // Quiet — admin still has status + limit usable.
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-2">
      {/* Mobile toggle — tap to expand/collapse the filter row.
          Shows an active-count badge so admin knows filters are
          applied even when the row is hidden. */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40 md:hidden"
        aria-expanded={mobileOpen}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <span className="font-medium">Bộ lọc</span>
          {activeCount > 0 && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              {activeCount}
            </Badge>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            mobileOpen && "rotate-180",
          )}
        />
      </button>

      {/* Filter row — always rendered on md+ (existing inline layout).
          On mobile, hidden when collapsed; the 'md:flex md:flex-wrap'
          classes ensure desktop is unaffected regardless of mobileOpen. */}
      <div
        className={cn(
          "grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center",
          !mobileOpen && "hidden md:flex",
        )}
      >
      <Select
        value={value.status}
        onValueChange={(v) => v && onChange({ ...value, status: v })}
      >
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue placeholder="Trạng thái" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tất cả trạng thái</SelectItem>
          <SelectItem value="succeeded">Thành công</SelectItem>
          <SelectItem value="failed">Thất bại</SelectItem>
          <SelectItem value="refunded">Đã hoàn</SelectItem>
          <SelectItem value="pending">Đang chờ</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={value.codeId}
        onValueChange={(v) => v && onChange({ ...value, codeId: v })}
      >
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Khách hàng" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tất cả khách</SelectItem>
          {codes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.label ?? c.id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.keyId}
        onValueChange={(v) => v && onChange({ ...value, keyId: v })}
      >
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="API Key" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tất cả key</SelectItem>
          {keys.map((k) => (
            <SelectItem key={k.id} value={k.id}>
              {k.label} {k.isActive ? "" : "(inactive)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(value.limit)}
        onValueChange={(v) =>
          v && onChange({ ...value, limit: Number(v) || 100 })
        }
      >
        <SelectTrigger className="w-full sm:w-[120px]">
          <SelectValue placeholder="Limit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="50">50 dòng</SelectItem>
          <SelectItem value="100">100 dòng</SelectItem>
          <SelectItem value="200">200 dòng</SelectItem>
          <SelectItem value="500">500 dòng</SelectItem>
          <SelectItem value="2000">2000 dòng</SelectItem>
        </SelectContent>
      </Select>
      </div>
    </div>
  );
}
