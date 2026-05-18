"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { formatVnd, formatVndWithEur } from "@/lib/format-currency";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BulkCreateCodeDialog } from "./bulk-create-dialog";
import { MultiSelectActions } from "./multi-select-actions";

type Mode = "unlimited" | "quota" | "topup";

interface CodeRow {
  id: string;
  code: string;
  label: string | null;
  mode: Mode;
  quotaEur: string | null;
  usedEur: string;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  videosGenerated: number;
}

export default function AdminCodesPage() {
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Selection state for bulk actions (revoke / reactivate / topup).
  // Cleared on Refresh / page navigation; non-persistent.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes");
      const json = await res.json();
      if (json.ok) setRows(json.codes);
      // Drop stale selections after reload — codes might have been
      // deleted, or admin shouldn't operate on stale state.
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Activation codes</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {rows.length} {rows.length === 1 ? "code" : "codes"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <BulkCreateCodeDialog onCreated={load} />
          <CreateCodeDialog onCreated={load} />
        </div>
      </header>

      <MultiSelectActions
        selectedIds={selected}
        onClear={clearSelection}
        onChanged={load}
      />

      {/* ── Desktop (md+): table unchanged ─────────────────────── */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          {/* Horizontal scroll wrapper so the 7-column table doesn't
              force-clip on a phone viewport. ScrollArea handles
              vertical; this div handles X. */}
          <ScrollArea className="max-h-[calc(100vh-220px)]">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
                  <th className="w-8 px-3 py-2 text-left">
                    {/* Select-all toggle — checked when every row selected,
                        indeterminate not shown (not worth the visual noise). */}
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === rows.length}
                      onChange={toggleSelectAll}
                      aria-label="Chọn tất cả codes"
                      className="size-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Label</th>
                  <th className="px-3 py-2 text-left font-medium">Mode</th>
                  <th className="px-3 py-2 text-right font-medium">Used / Quota</th>
                  <th className="px-3 py-2 text-right font-medium">Videos</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <CodeRowItem
                    key={r.id}
                    row={r}
                    onChanged={load}
                    selected={selected.has(r.id)}
                    onToggleSelect={() => toggleSelect(r.id)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No codes yet. Click &quot;Create code&quot; to mint one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── Mobile (<md): card list — same data, vertical layout ── */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <CodeMobileCard
            key={r.id}
            row={r}
            onChanged={load}
            selected={selected.has(r.id)}
            onToggleSelect={() => toggleSelect(r.id)}
          />
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Chưa có code nào. Nhấn nút <span className="font-medium">+</span>{" "}
              ở góc phải dưới để tạo.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Mobile card variant of the codes-table row. Vertical layout, larger
 * touch targets, same backend calls (toggle active / top-up / copy)
 * inlined from CodeRowItem so customer admin gets identical
 * functionality without dragging the table component in.
 */
function CodeMobileCard({
  row,
  onChanged,
  selected,
  onToggleSelect,
}: {
  row: CodeRow;
  onChanged: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(row.code);
    setCopied(true);
    toast.success("Đã copy code");
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/codes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) toast.error("Cập nhật thất bại");
      else {
        toast.success(row.isActive ? "Đã thu hồi code" : "Đã khôi phục code");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    const input = prompt("Nạp thêm số dư (VND):", "10000");
    if (!input) return;
    const vnd = Number(input.replace(/[^\d]/g, ""));
    if (!Number.isFinite(vnd) || vnd <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    const eur = vnd / 1000;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/codes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addEur: eur }),
      });
      if (!res.ok) toast.error("Nạp thất bại");
      else {
        toast.success(`Đã nạp ${formatVnd(eur)}`);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  const usedEur = Number(row.usedEur);
  const quotaEur = row.quotaEur ? Number(row.quotaEur) : null;
  const remainingPct = quotaEur ? (usedEur / quotaEur) * 100 : null;

  return (
    <Card className={selected ? "ring-2 ring-primary" : undefined}>
      <CardContent className="space-y-3 p-3">
        {/* Header: checkbox + label + status dot */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Chọn code ${row.label ?? row.code.slice(0, 8)}`}
              className="mt-0.5 size-4 cursor-pointer"
            />
            <div className="min-w-0">
              <Link
                href={`/dashboard/codes/${row.id}`}
                className="inline-flex items-center gap-1 truncate text-sm font-medium hover:text-primary hover:underline"
              >
                {row.label ?? "(chưa đặt tên)"}
                <ExternalLink className="size-3 opacity-50" />
              </Link>
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {row.mode}
              </Badge>
            </div>
          </div>
          <Badge
            variant={row.isActive ? "default" : "destructive"}
            className="shrink-0 text-[10px]"
          >
            {row.isActive ? "active" : "revoked"}
          </Badge>
        </div>

        {/* Code chip + copy */}
        <button
          type="button"
          onClick={copyCode}
          className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
          title="Tap để copy code"
        >
          <code className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {row.code}
          </code>
          {copied ? (
            <Check className="size-3.5 shrink-0 text-emerald-600" />
          ) : (
            <Copy className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>

        {/* Quota usage */}
        {quotaEur !== null ? (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Đã dùng</span>
              <span
                className="font-mono"
                title={`${usedEur.toFixed(2)} / ${quotaEur.toFixed(2)} EUR`}
              >
                {formatVnd(usedEur)} / {formatVnd(quotaEur)}
              </span>
            </div>
            <Progress value={remainingPct ?? 0} className="h-1.5" />
          </div>
        ) : (
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Đã dùng</span>
            <span className="font-mono">{formatVnd(usedEur)} / ∞</span>
          </div>
        )}

        {/* Meta + actions row */}
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-[11px] text-muted-foreground">
            {row.videosGenerated} video
          </span>
          <div className="flex gap-1">
            {row.mode === "topup" && row.isActive && (
              <Button variant="outline" size="xs" onClick={topUp} disabled={busy}>
                Nạp
              </Button>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={toggleActive}
              disabled={busy}
            >
              {row.isActive ? "Thu hồi" : "Khôi phục"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CodeRowItem({
  row,
  onChanged,
  selected,
  onToggleSelect,
}: {
  row: CodeRow;
  onChanged: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(row.code);
    setCopied(true);
    toast.success("Code copied");
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/codes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) toast.error("Update failed");
      else {
        toast.success(row.isActive ? "Code revoked" : "Code restored");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    // Admin enters VND directly — convert to EUR for the backend.
    // 1,000 đ ↔ 1 EUR (see lib/format-currency.ts).
    const input = prompt("Nạp thêm số dư cho code (VND):", "10000");
    if (!input) return;
    const vnd = Number(input.replace(/[^\d]/g, ""));
    if (!Number.isFinite(vnd) || vnd <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    const eur = vnd / 1000;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/codes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addEur: eur }),
      });
      if (!res.ok) toast.error("Top-up failed");
      else {
        toast.success(`Đã nạp ${formatVnd(eur)}`);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`border-t ${selected ? "bg-primary/5" : ""}`}>
      <td className="w-8 px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Chọn code ${row.label ?? row.code.slice(0, 8)}`}
          className="size-4 cursor-pointer"
        />
      </td>
      <td className="px-3 py-2 font-mono text-[11px]">
        <button
          onClick={copyCode}
          className="inline-flex items-center gap-1 hover:text-primary"
          title="Copy code"
        >
          {row.code.slice(0, 22)}...
          {copied ? <Check className="size-3" /> : <Copy className="size-3 opacity-50" />}
        </button>
      </td>
      <td className="px-3 py-2">
        <Link
          href={`/dashboard/codes/${row.id}`}
          className="inline-flex items-center gap-1 hover:text-primary hover:underline"
          title="Mở drilldown — usage chi tiết + export CSV"
        >
          {row.label ?? "—"}
          <ExternalLink className="size-3 opacity-50" />
        </Link>
      </td>
      <td className="px-3 py-2">
        <Badge variant="secondary" className="text-[10px]">
          {row.mode}
        </Badge>
      </td>
      <td
        className="px-3 py-2 text-right font-mono"
        title={`${Number(row.usedEur).toFixed(2)} / ${row.quotaEur ? Number(row.quotaEur).toFixed(2) : "∞"} EUR (internal)`}
      >
        {formatVnd(Number(row.usedEur))} /{" "}
        {row.quotaEur ? formatVnd(Number(row.quotaEur)) : "∞"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.videosGenerated}</td>
      <td className="px-3 py-2">
        <Badge
          variant={row.isActive ? "default" : "destructive"}
          className="text-[10px]"
        >
          {row.isActive ? "active" : "revoked"}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-1">
          {row.mode === "topup" && row.isActive && (
            <Button variant="ghost" size="xs" onClick={topUp} disabled={busy}>
              Top-up
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={toggleActive}
            disabled={busy}
          >
            {row.isActive ? "Revoke" : "Restore"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function CreateCodeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("quota");
  const [quotaEur, setQuotaEur] = useState("100");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        mode,
        customerLabel: label || undefined,
      };
      if (mode !== "unlimited") {
        const q = Number(quotaEur);
        if (!Number.isFinite(q) || q <= 0) {
          toast.error("Quota must be a positive number");
          return;
        }
        body.quotaEur = q;
      }
      if (expiresInDays) {
        const d = Number(expiresInDays);
        if (!Number.isFinite(d) || d <= 0) {
          toast.error("Expires-in-days must be positive");
          return;
        }
        body.expiresInDays = d;
      }

      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Create failed");
        return;
      }
      setCreatedCode(json.created.code);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCreatedCode(null);
    setLabel("");
    setQuotaEur("100");
    setExpiresInDays("");
    setMode("quota");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {/* Desktop trigger — sits inline in the header. Hidden on mobile
          because the FAB below takes over the primary-action role. */}
      <DialogTrigger
        render={
          <Button size="sm" className="hidden md:inline-flex">
            <Plus className="size-3.5" />
            Create code
          </Button>
        }
      />
      {/* Mobile FAB — fixed bottom-right, clears the bottom tab bar
          (bottom-20 ≈ tab height) + safe-area inset. Same dialog
          backend so functionality is identical. */}
      <DialogTrigger
        render={
          <Button
            size="icon"
            className="fixed right-4 z-30 size-14 rounded-full shadow-lg md:hidden"
            aria-label="Tạo code mới"
            style={{
              bottom: "calc(5rem + env(safe-area-inset-bottom))",
            }}
          >
            <Plus className="size-6" />
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New activation code</DialogTitle>
        </DialogHeader>

        {createdCode ? (
          <div className="space-y-3">
            <p className="text-sm">
              Code created. Copy it now — you can&apos;t see it again later
              (only the prefix is shown in the table).
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
              <code className="flex-1 font-mono text-xs break-all">
                {createdCode}
              </code>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(createdCode);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3" />
                Copy
              </Button>
            </div>
            <Button onClick={() => setOpen(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quota">
                    Quota — fixed cap, no top-ups
                  </SelectItem>
                  <SelectItem value="topup">
                    Top-up — admin nạp thêm theo thời gian
                  </SelectItem>
                  <SelectItem value="unlimited">
                    Unlimited — no cap (use sparingly)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode !== "unlimited" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Initial quota</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quotaEur}
                  onChange={(e) => setQuotaEur(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Nhập theo EUR (1 EUR = 1.000 đ).{" "}
                  {quotaEur && Number(quotaEur) > 0
                    ? `≈ ${formatVndWithEur(Number(quotaEur))}`
                    : ""}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Customer label (optional)</Label>
              <Input
                placeholder="e.g. Khách A — tom@example.com"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Expires in N days (optional, blank = never)
              </Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 30"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating..." : "Create code"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
