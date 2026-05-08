"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Copy, Check } from "lucide-react";
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

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes");
      const json = await res.json();
      if (json.ok) setRows(json.codes);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Activation codes</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "code" : "codes"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <CreateCodeDialog onCreated={load} />
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
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
                  <CodeRowItem key={r.id} row={r} onChanged={load} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No codes yet. Click &quot;Create code&quot; to mint one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeRowItem({ row, onChanged }: { row: CodeRow; onChanged: () => void }) {
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
    <tr className="border-t">
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
      <td className="px-3 py-2">{row.label ?? "—"}</td>
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
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-3.5" />
            Create code
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
