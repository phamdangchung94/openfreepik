"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatVndWithEur } from "@/lib/format-currency";

interface KeyRow {
  id: string;
  label: string;
  /**
   * Decrypted Freepik API key. Null if KEY_ENCRYPTION_SECRET rotated
   * and the stored ciphertext can no longer be decrypted — admin must
   * re-enter that key.
   */
  plaintextKey: string | null;
  /**
   * Whether this key has a Magnific webhook secret configured. The
   * secret itself isn't returned to the browser — only the presence
   * flag — since admin only needs to know "is this key opted in to
   * push delivery?" Migration 0007.
   */
  hasWebhookSecret?: boolean;
  assignedEur: string;
  usedEur: string;
  isActive: boolean;
  /**
   * Default 8 (set by migration 0006). Older rows fetched from a not-yet-
   * deployed server may omit it; render as 8 in the UI for back-compat.
   */
  maxConcurrent?: number;
  notes: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  bodySnippet: string;
  elapsedMs: number;
  errorMessage?: string;
  fetchedAt: number;
}

export default function AdminKeysPage() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Probe results live here so the parent owns them — refresh-all writes
  // them all at once, single-key refresh writes one entry.
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [probingIds, setProbingIds] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/keys");
      const json = await res.json();
      if (json.ok) setRows(json.keys);
    } finally {
      setLoading(false);
    }
  }

  async function reactivateAll() {
    if (!confirm("Reactivate every inactive key? Use only when the pool was drained by a transient failure.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/keys/reactivate-all", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Reactivate failed");
        return;
      }
      toast.success(`${json.count} key(s) reactivated`);
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function refreshOne(id: string) {
    setProbingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/admin/keys/${id}/refresh-quota`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Probe failed");
        return;
      }
      setProbes((p) => ({
        ...p,
        [id]: { ...json.probe, fetchedAt: Date.now() },
      }));
      toast.success(`Cập nhật xong: HTTP ${json.probe.status}`);
    } finally {
      setProbingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  async function refreshAllQuotas() {
    const ids = rows.map((r) => r.id);
    setProbingIds(new Set(ids));
    try {
      const res = await fetch("/api/admin/keys/refresh-all-quotas", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Refresh failed");
        return;
      }
      const now = Date.now();
      const next: Record<string, ProbeResult> = {};
      for (const r of json.results as Array<{ id: string; probe: ProbeResult }>) {
        next[r.id] = { ...r.probe, fetchedAt: now };
      }
      setProbes((p) => ({ ...p, ...next }));
      const okCount = (json.results as Array<{ probe: { ok: boolean } }>).filter(
        (r) => r.probe.ok,
      ).length;
      toast.success(`Đã probe ${json.count} key — ${okCount} OK / ${json.count - okCount} fail`);
    } finally {
      setProbingIds(new Set());
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">API keys</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {rows.length} {rows.length === 1 ? "key" : "keys"} in the rotation
            pool. Spend tracked locally — upstream exposes no balance API, so
            verify against the provider dashboard periodically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAllQuotas}
            disabled={loading || probingIds.size > 0 || rows.length === 0}
            title="Probe every key against upstream. Captures rate-limit/quota response headers."
          >
            <Activity
              className={`size-3.5 ${probingIds.size > 0 ? "animate-pulse" : ""}`}
            />
            Cập nhật all
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={reactivateAll}
            disabled={loading}
            title="Flip every is_active=false back to true. Emergency pool recovery."
          >
            <RotateCcw className="size-3.5" />
            Reactivate all
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <AddKeyDialog onAdded={load} />
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((k) => (
          <KeyCard
            key={k.id}
            row={k}
            onChanged={load}
            probe={probes[k.id]}
            probing={probingIds.has(k.id)}
            onRefresh={() => refreshOne(k.id)}
          />
        ))}
        {rows.length === 0 && (
          <Card className="md:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No API keys yet — add one so customers can generate.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function KeyCard({
  row,
  onChanged,
  probe,
  probing,
  onRefresh,
}: {
  row: KeyRow;
  onChanged: () => void;
  probe?: ProbeResult;
  probing: boolean;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const used = Number(row.usedEur);
  const assigned = Number(row.assignedEur);
  const pct = assigned > 0 ? (used / assigned) * 100 : 0;

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/keys/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) toast.error("Update failed");
      else {
        toast.success(row.isActive ? "Key deactivated" : "Key reactivated");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete key "${row.label}"? Lịch sử usage_logs giữ lại nhưng key blob mất vĩnh viễn — phải nhập lại plaintext nếu muốn dùng lại.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/keys/${row.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Delete failed");
        return;
      }
      toast.success(`Đã xoá "${row.label}"`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium">{row.label}</h3>
            {row.notes && (
              <p className="text-[11px] text-muted-foreground">{row.notes}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {row.hasWebhookSecret && (
              <Badge
                variant="outline"
                className="text-[10px]"
                title="Magnific posts task completions to /api/freepik/webhook for this key"
              >
                webhook
              </Badge>
            )}
            <Badge
              variant={row.isActive ? "default" : "secondary"}
              className="text-[10px]"
            >
              {row.isActive ? "active" : "inactive"}
            </Badge>
          </div>
        </div>

        <ApiKeyDisplay plaintextKey={row.plaintextKey} />

        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Spent</span>
            <span className="font-mono" title={`${used.toFixed(2)} / ${assigned.toFixed(2)} EUR`}>
              {formatVndWithEur(used)} / {formatVndWithEur(assigned)}
            </span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">
            Last used:{" "}
            {row.lastUsedAt
              ? new Date(row.lastUsedAt).toLocaleString()
              : "never"}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={onRefresh}
              disabled={probing}
              title="Probe upstream for quota / rate-limit headers"
            >
              <Zap
                className={`size-3.5 ${probing ? "animate-pulse text-amber-500" : ""}`}
              />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={toggle}
              disabled={busy}
              title={row.isActive ? "Deactivate" : "Reactivate"}
            >
              {row.isActive ? "Deactivate" : "Reactivate"}
            </Button>
            <EditKeyDialog row={row} onSaved={onChanged} />
            <Button
              variant="ghost"
              size="xs"
              onClick={remove}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Delete key"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {probe && <ProbeResultPanel probe={probe} />}
      </CardContent>
    </Card>
  );
}

function ProbeResultPanel({ probe }: { probe: ProbeResult }) {
  const ageSec = Math.floor((Date.now() - probe.fetchedAt) / 1000);
  const ageStr = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
  const headerEntries = Object.entries(probe.headers);

  const statusColor = probe.ok
    ? "text-emerald-600"
    : probe.status === 401
      ? "text-destructive"
      : "text-amber-600";

  return (
    <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">Upstream probe</span>
        <span className="text-muted-foreground">
          {ageStr} ago · {probe.elapsedMs}ms
        </span>
      </div>
      <div className={`font-mono ${statusColor}`}>
        HTTP {probe.status || "ERR"} {probe.ok ? "✓ key valid" : ""}
      </div>
      {probe.errorMessage && (
        <div className="mt-1 truncate font-mono text-destructive">
          {probe.errorMessage}
        </div>
      )}
      {headerEntries.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {headerEntries.map(([k, v]) => (
            <div key={k} className="flex gap-2 font-mono">
              <span className="shrink-0 text-muted-foreground">{k}:</span>
              <span className="truncate">{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-muted-foreground">
          (Không có header quota/rate-limit nào trả về)
        </div>
      )}
      {!probe.ok && probe.bodySnippet && (
        <div className="mt-1.5 truncate font-mono text-muted-foreground">
          {probe.bodySnippet}
        </div>
      )}
    </div>
  );
}

function ApiKeyDisplay({ plaintextKey }: { plaintextKey: string | null }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!plaintextKey) return;
    navigator.clipboard.writeText(plaintextKey);
    setCopied(true);
    toast.success("API key copied");
    setTimeout(() => setCopied(false), 1500);
  }

  if (!plaintextKey) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
        Decrypt failed — KEY_ENCRYPTION_SECRET may have rotated. Re-enter this key.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[11px]" title={plaintextKey}>
        {plaintextKey}
      </code>
      <Button
        variant="ghost"
        size="xs"
        onClick={copy}
        title="Copy API key"
        className="shrink-0"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function EditKeyDialog({
  row,
  onSaved,
}: {
  row: KeyRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(row.label);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [assignedEur, setAssignedEur] = useState(row.assignedEur);
  const [usedEur, setUsedEur] = useState(row.usedEur);
  const [maxConcurrent, setMaxConcurrent] = useState(
    String(row.maxConcurrent ?? 8),
  );
  const [busy, setBusy] = useState(false);

  // Reset form ONLY at the open->close->open transition. The earlier
  // useEffect([open, row]) implementation re-ran on every parent
  // re-render (the rows array is rebuilt from a fetch, so `row` is a
  // new object reference each time) — typing in any field would get
  // clobbered the next time the page refetched keys. Pull the reset
  // into the open-state setter so it fires exactly when the customer
  // opens the dialog, not whenever the parent renders.
  function handleOpenChange(next: boolean) {
    if (next && !open) {
      setLabel(row.label);
      setNotes(row.notes ?? "");
      setAssignedEur(row.assignedEur);
      setUsedEur(row.usedEur);
      setMaxConcurrent(String(row.maxConcurrent ?? 8));
    }
    setOpen(next);
  }

  const remaining = Math.max(Number(assignedEur) - Number(usedEur), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        label,
        notes: notes.trim() === "" ? null : notes,
        assignedEur: Number(assignedEur),
        maxConcurrent: Number(maxConcurrent) || 8,
      };
      // Only PATCH usedEur when admin actually changed it — avoids
      // racing with the orchestrator's recordKeyCost increments.
      if (Number(usedEur) !== Number(row.usedEur)) {
        body.usedEur = Number(usedEur);
      }
      const res = await fetch(`/api/admin/keys/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Update failed");
        return;
      }
      toast.success("Đã lưu");
      setOpen(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="xs" title="Edit key">
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa key</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>

          {/* Budget block — assigned + used + computed remaining. The
              "Số dư còn lại" line lets admin see the impact of any
              edit without doing math in their head. */}
          <div className="space-y-1.5 rounded-md border bg-muted/20 p-2.5">
            <Label className="text-xs font-semibold">Ngân sách</Label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">
                  Tổng được cấp
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={assignedEur}
                  onChange={(e) => setAssignedEur(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">
                  Đã chi (sửa nếu cần)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={usedEur}
                  onChange={(e) => setUsedEur(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground">
                Số dư còn lại:
              </span>
              <span className="font-mono text-sm font-semibold">
                {formatVndWithEur(remaining)}
              </span>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setUsedEur("0")}
                className="h-6 text-[10px]"
                title="Đặt số đã chi về 0 (sau khi nạp credit upstream)"
              >
                Reset đã chi → 0
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Số luồng tối đa cùng lúc{" "}
              <span className="text-muted-foreground">(mặc định 8)</span>
            </Label>
            <Input
              type="number"
              min="1"
              max="64"
              step="1"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Cap song song trên key này — khi đạt cap, request mới sẽ vào
              hàng đợi cho tới khi có slot trống.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <p className="rounded bg-muted p-2 text-[11px] text-muted-foreground">
            Plaintext key không sửa được — nếu cần đổi, hãy xoá rồi thêm
            mới (lịch sử usage_logs vẫn được giữ).
          </p>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving..." : "Lưu"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddKeyDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [assignedEur, setAssignedEur] = useState("500");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          plaintextKey,
          webhookSecret: webhookSecret.trim() || undefined,
          assignedEur: Number(assignedEur),
          notes: notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Add failed");
        return;
      }
      toast.success("Key added");
      setLabel("");
      setPlaintextKey("");
      setWebhookSecret("");
      setAssignedEur("500");
      setNotes("");
      setOpen(false);
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-3.5" />
            Add key
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add API key</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Label</Label>
            <Input
              placeholder="e.g. Account 2 — alice@example.com"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API key (plaintext)</Label>
            <Input
              type="password"
              placeholder="FPSX..."
              value={plaintextKey}
              onChange={(e) => setPlaintextKey(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              Stored AES-GCM encrypted. Plaintext is never persisted in logs.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Webhook secret (optional)</Label>
            <Input
              type="password"
              placeholder="whsec_... or hex / base64"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              Magnific webhook signing secret. When set, this key opts
              into push delivery — Magnific posts task completions to
              /api/freepik/webhook. Leave empty to use client polling.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assigned budget (EUR — internal)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={assignedEur}
              onChange={(e) => setAssignedEur(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Default 500 — provider&apos;s free-tier credit per account.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Adding..." : "Add key"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
