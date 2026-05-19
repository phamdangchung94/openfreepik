"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  RefreshCw,
  Trash2,
  KeyRound,
  Copy,
  Check,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { Card, CardContent } from "@/components/ui/card";

interface ApiKeyRow {
  id: string;
  label: string;
  codeId: string;
  customerLabel: string | null;
  rateLimitPerMin: number | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface CodeOption {
  id: string;
  label: string | null;
  code: string;
}

export default function AdminApiKeysPage() {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [codes, setCodes] = useState<CodeOption[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/api-keys");
      const json = await res.json();
      if (json.ok) setRows(json.keys);
    } finally {
      setLoading(false);
    }
  }

  async function loadCodes() {
    try {
      const res = await fetch("/api/admin/codes");
      const json = await res.json();
      if (json.ok) {
        // /api/admin/codes returns customerLabel as `label`
        setCodes(
          (json.codes as Array<{ id: string; label: string | null; code: string }>).map(
            (c) => ({ id: c.id, label: c.label, code: c.code }),
          ),
        );
      }
    } catch {
      // best-effort — admin can still see existing keys
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!confirm(`Revoke API key "${label}"? Customer dùng key này sẽ nhận 401 ngay.`)) return;
    const res = await fetch(`/api/admin/api-keys?id=${id}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (json.ok) {
      toast.success(`Đã revoke "${label}"`);
      load();
    } else {
      toast.error(json.message ?? "Revoke failed");
    }
  }

  useEffect(() => {
    load();
    loadCodes();
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">API keys</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Programmatic access keys cho /api/v1/*. Mỗi key link tới 1
            activation code (billing chảy qua code đó).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/docs/api"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <BookOpen className="size-3.5" />
            Tài liệu API
          </Link>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <CreateApiKeyDialog codes={codes} onCreated={load} />
        </div>
      </header>

      {rows.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <KeyRound className="size-8" />
            <p>Chưa có API key nào.</p>
            <CreateApiKeyDialog codes={codes} onCreated={load} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{r.label}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Code: {r.customerLabel ?? "(no label)"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge
                    variant={r.isActive ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {r.isActive ? "active" : "revoked"}
                  </Badge>
                  {r.expiresAt && new Date(r.expiresAt) < new Date() && (
                    <Badge variant="destructive" className="text-[10px]">
                      expired
                    </Badge>
                  )}
                </div>
              </div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>
                  Rate limit:{" "}
                  <span className="text-foreground">
                    {r.rateLimitPerMin
                      ? `${r.rateLimitPerMin} req/min`
                      : "Mặc định endpoint"}
                  </span>
                </p>
                <p>
                  Last used:{" "}
                  <span className="text-foreground">
                    {r.lastUsedAt
                      ? new Date(r.lastUsedAt).toLocaleString()
                      : "Chưa dùng"}
                  </span>
                </p>
                <p>
                  Created: {new Date(r.createdAt).toLocaleDateString()}
                  {r.expiresAt && (
                    <>
                      {" "}
                      · Expires {new Date(r.expiresAt).toLocaleDateString()}
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRevoke(r.id, r.label)}
                className="w-full"
              >
                <Trash2 className="size-3.5 text-destructive" />
                Revoke
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateApiKeyDialog({
  codes,
  onCreated,
}: {
  codes: CodeOption[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [codeId, setCodeId] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !codeId) {
      toast.error("Cần label + chọn activation code");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        label: label.trim(),
        codeId,
      };
      if (rateLimit) {
        const n = Number(rateLimit);
        if (Number.isFinite(n) && n > 0) body.rateLimitPerMin = n;
      }
      if (expiresInDays) {
        const n = Number(expiresInDays);
        if (Number.isFinite(n) && n > 0) body.expiresInDays = n;
      }
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Create failed");
        return;
      }
      setPlaintext(json.plaintext);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  async function copyPlaintext() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success("Đã copy API key");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy thất bại — chọn thủ công từ ô bên dưới");
    }
  }

  function reset() {
    setPlaintext(null);
    setCopied(false);
    setLabel("");
    setCodeId("");
    setRateLimit("");
    setExpiresInDays("");
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
            <Plus className="size-3.5" /> Mint key
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {plaintext ? "API key đã tạo" : "Tạo API key mới"}
          </DialogTitle>
        </DialogHeader>

        {plaintext ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                Lưu lại key ngay
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Em chỉ store SHA-256 hash trong DB — không thể xem lại
                plaintext sau khi đóng dialog. Customer copy ngay và bảo
                quản như password.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {plaintext}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyPlaintext}
                aria-label="Copy API key"
                className="size-9 shrink-0 [&_svg]:size-3.5"
              >
                {copied ? <Check className="text-emerald-500" /> : <Copy />}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setOpen(false)}>
                Xong
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div>
              <Label htmlFor="ak-label">Label *</Label>
              <Input
                id="ak-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder="e.g. ChugAx mobile app · production"
                required
              />
            </div>
            <div>
              <Label>Activation code *</Label>
              <Select value={codeId} onValueChange={(v) => setCodeId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn code customer" />
                </SelectTrigger>
                <SelectContent>
                  {codes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label ?? c.code.slice(0, 16)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Billing + quota chảy qua code này.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="ak-rate">Rate limit (req/min)</Label>
                <Input
                  id="ak-rate"
                  type="number"
                  min={1}
                  max={600}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  placeholder="Mặc định endpoint"
                />
              </div>
              <div>
                <Label htmlFor="ak-expires">Hết hạn sau N ngày</Label>
                <Input
                  id="ak-expires"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="Không hết hạn"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Đang tạo…" : "Tạo key"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
