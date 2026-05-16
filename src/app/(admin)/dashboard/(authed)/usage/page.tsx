"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UsageStats } from "./usage-stats";
import {
  UsageFilters,
  type UsageFilterValue,
  ALL,
} from "./usage-filters";
import { UsageTable, type UsageLogRow } from "./usage-table";

const DEFAULT_FILTERS: UsageFilterValue = {
  status: ALL,
  codeId: ALL,
  keyId: ALL,
  limit: 100,
};

/**
 * Admin usage dashboard. Three stacked sections:
 *   1. UsageStats — KPI cards + tier split + top customers + 14d bars.
 *   2. UsageFilters — status / customer / key / row limit dropdowns.
 *   3. UsageTable — row list with column-visibility toggle + CSV export.
 *
 * Refresh button bumps a `refreshKey` counter; UsageStats subscribes to
 * it and re-fetches the summary so KPIs stay synced with the table.
 */
export default function AdminUsagePage() {
  const [rows, setRows] = useState<UsageLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<UsageFilterValue>(DEFAULT_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(filters.limit) });
      if (filters.status !== ALL) params.set("status", filters.status);
      if (filters.codeId !== ALL) params.set("codeId", filters.codeId);
      if (filters.keyId !== ALL) params.set("keyId", filters.keyId);
      const res = await fetch(`/api/admin/usage?${params}`);
      const json = await res.json();
      if (json.ok) setRows(json.logs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshKey]);

  function refreshAll() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Usage logs</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Đang xem {rows.length} log gần nhất
            {filters.status === ALL ? "" : ` · trạng thái ${filters.status}`}
            {filters.codeId !== ALL ? " · filter khách" : ""}
            {filters.keyId !== ALL ? " · filter key" : ""}.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      <UsageStats refreshKey={refreshKey} />

      <UsageFilters value={filters} onChange={setFilters} />

      <UsageTable rows={rows} />
    </div>
  );
}
