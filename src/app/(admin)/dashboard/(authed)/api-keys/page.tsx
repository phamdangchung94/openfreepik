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
  ExternalLink,
  Wallet,
  Activity,
  Eye,
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
  /** Linked activation code balance snapshot. */
  account: {
    mode: "unlimited" | "quota" | "topup" | null;
    isActive: boolean | null;
    quotaEur: number | null;
    usedEur: number;
    remainingEur: number | null;
  };
  /** Per-key usage aggregate over last 30 days. */
  usage30d: {
    reqCount: number;
    successCount: number;
    refundedCount: number;
    failedCount: number;
    pendingCount: number;
    spendEur: number;
  };
  /**
   * True when the row has an encrypted plaintext on file (migration
   * 0018+). False for legacy keys — UI hides the Reveal button.
   */
  hasPlaintext: boolean;
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
          <h1 className="text-xl font-semibold sm:text-2xl">API Tokens</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Bearer credentials (<code className="font-mono text-[11px]">sk_*</code>) cho{" "}
            <code className="font-mono text-[11px]">/api/v1/*</code>. Mỗi
            token link tới 1 activation code — billing + balance chảy qua
            code đó.
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
          <ApiTokenCard key={r.id} row={r} onRevoke={handleRevoke} />
        ))}
      </div>
    </div>
  );
}

/**
 * Per-token detail card. Surface everything an admin needs to answer
 * "what's going on with this key" without leaving the page:
 *   - Health badges (active/revoked, expired, account inactive)
 *   - Linked activation code balance + progress bar
 *   - Last 30d activity (request count, spend, success/failed/refunded breakdown)
 *   - Rate limit + last-used + created/expires
 *   - Copy token ID + link to drill into the linked code
 */
function ApiTokenCard({
  row,
  onRevoke,
}: {
  row: ApiKeyRow;
  onRevoke: (id: string, label: string) => void;
}) {
  const [idCopied, setIdCopied] = useState(false);
  const expired = row.expiresAt && new Date(row.expiresAt) < new Date();
  const accountInactive = row.account.isActive === false;
  const lowBalance =
    row.account.remainingEur !== null && row.account.remainingEur < 1;
  const balancePct =
    row.account.quotaEur && row.account.quotaEur > 0
      ? Math.min(100, (row.account.usedEur / row.account.quotaEur) * 100)
      : null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(row.id);
      setIdCopied(true);
      toast.success("Đã copy token ID");
      setTimeout(() => setIdCopied(false), 1500);
    } catch {
      toast.error("Copy thất bại");
    }
  }

  return (
    <Card className={cn(!row.isActive && "opacity-60")}>
      <CardContent className="space-y-3 p-4 text-sm">
        {/* Header: label + status badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{row.label}</h3>
            <p className="text-[11px] text-muted-foreground">
              Account:{" "}
              <Link
                href={`/dashboard/codes`}
                className="hover:text-foreground hover:underline"
              >
                {row.customerLabel ?? "(no label)"}
              </Link>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <Badge
                variant={row.isActive ? "default" : "secondary"}
                className="text-[10px]"
              >
                {row.isActive ? "active" : "revoked"}
              </Badge>
              {expired && (
                <Badge variant="destructive" className="text-[10px]">
                  expired
                </Badge>
              )}
              {accountInactive && (
                <Badge variant="destructive" className="text-[10px]">
                  account off
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Balance — only meaningful for topup/quota mode */}
        {row.account.mode === "unlimited" ? (
          <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5 text-[11px]">
            <Wallet className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">Balance:</span>
            <span className="font-medium text-foreground">không giới hạn</span>
          </div>
        ) : (
          <div className="space-y-1 rounded-md bg-muted/30 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Wallet className="size-3" />
                Balance
              </span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  lowBalance ? "text-amber-600 dark:text-amber-400" : "text-foreground",
                )}
              >
                {fmtEur(row.account.remainingEur)} còn /{" "}
                {fmtEur(row.account.quotaEur)} cấp
              </span>
            </div>
            {balancePct !== null && (
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    balancePct > 90
                      ? "bg-destructive"
                      : balancePct > 70
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                  style={{ width: `${balancePct}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Usage 30d */}
        <div className="space-y-1 rounded-md bg-muted/30 px-2 py-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="size-3" />
              30 ngày qua
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {row.usage30d.reqCount} requests · {fmtEur(row.usage30d.spendEur)} spent
            </span>
          </div>
          {row.usage30d.reqCount > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
              {row.usage30d.successCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {row.usage30d.successCount} success
                </span>
              )}
              {row.usage30d.refundedCount > 0 && (
                <span>↩ {row.usage30d.refundedCount} refunded</span>
              )}
              {row.usage30d.failedCount > 0 && (
                <span className="text-destructive">
                  ✗ {row.usage30d.failedCount} failed
                </span>
              )}
              {row.usage30d.pendingCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  ⏳ {row.usage30d.pendingCount} pending
                </span>
              )}
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <p>
            Rate limit:{" "}
            <span className="text-foreground">
              {row.rateLimitPerMin
                ? `${row.rateLimitPerMin} req/min`
                : "Mặc định endpoint"}
            </span>
          </p>
          <p>
            Last used:{" "}
            <span className="text-foreground">
              {row.lastUsedAt
                ? new Date(row.lastUsedAt).toLocaleString("vi-VN")
                : "Chưa dùng"}
            </span>
          </p>
          <p>
            Created: {new Date(row.createdAt).toLocaleDateString("vi-VN")}
            {row.expiresAt && (
              <>
                {" "}
                · Expires{" "}
                {new Date(row.expiresAt).toLocaleDateString("vi-VN")}
              </>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <RevealKeyButton row={row} />
          <Button
            variant="outline"
            size="sm"
            onClick={copyId}
            className="flex-1"
            title="Copy token ID — paste vào log query"
          >
            {idCopied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            Copy ID
          </Button>
          <Link
            href="/dashboard/codes"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "flex-1",
            )}
            title="Xem account chi tiết"
          >
            <ExternalLink className="size-3.5" />
            Account
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRevoke(row.id, row.label)}
            className="flex-1"
            disabled={!row.isActive}
          >
            <Trash2 className="size-3.5 text-destructive" />
            Revoke
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "Xem key" button — on click, fetches plaintext from /reveal endpoint
 * + opens dialog with copy button. For legacy keys (hasPlaintext=false),
 * renders disabled with a tooltip explaining why.
 */
function RevealKeyButton({ row }: { row: ApiKeyRow }) {
  const [open, setOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!row.hasPlaintext) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        disabled
        title="Key này được tạo trước khi tính năng lưu plaintext bật. Mint key mới để xem được."
      >
        <Eye className="size-3.5" />
        Xem key
      </Button>
    );
  }

  async function fetchPlaintext() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/api-keys/${row.id}/reveal`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Không lấy được plaintext");
        return;
      }
      setPlaintext(json.plaintext);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success("Đã copy");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy thất bại");
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        onClick={() => {
          setOpen(true);
          if (!plaintext) void fetchPlaintext();
        }}
        title="Xem plaintext key — gửi lại cho customer nếu họ mất"
      >
        <Eye className="size-3.5" />
        Xem key
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            // Clear plaintext on close so it's not lingering in React
            // state after dialog dismisses — refetched on next open.
            setPlaintext(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>API key: {row.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                Gửi key này qua kênh bảo mật (Zalo private, password manager)
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Mỗi lần xem được audit-log. Nếu nghi rò rỉ → Revoke + mint key mới.
              </p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <RefreshCw className="size-3.5 animate-spin" />
                Đang giải mã…
              </div>
            ) : plaintext ? (
              <div className="flex items-center gap-1.5">
                <code className="flex-1 select-all rounded bg-muted px-2 py-1.5 font-mono text-xs break-all">
                  {plaintext}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copy}
                  className="size-9 shrink-0 [&_svg]:size-3.5"
                  aria-label="Copy plaintext key"
                >
                  {copied ? <Check className="text-emerald-500" /> : <Copy />}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-destructive">Không lấy được key. Thử lại.</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setOpen(false)}>
                Đóng
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Format EUR as "X.XX €" with sensible precision (4 dp for <1, 2 dp otherwise). */
function fmtEur(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "0 €";
  const precision = Math.abs(value) < 1 ? 4 : 2;
  return `${value.toFixed(precision)} €`;
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
