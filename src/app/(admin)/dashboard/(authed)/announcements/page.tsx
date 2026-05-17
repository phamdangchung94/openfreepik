"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Pencil, Trash2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Severity = "info" | "warn" | "critical";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  severity: Severity;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Thông tin (xanh)",
  warn: "Cảnh báo (cam)",
  critical: "Khẩn cấp (đỏ)",
};

export default function AdminAnnouncementsPage() {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<AnnouncementRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      const json = await res.json();
      if (json.ok) setRows(json.announcements);
      else toast.error("Không tải được danh sách thông báo");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Xoá thông báo này? Hành động không hoàn tác được.")) return;
    const res = await fetch(`/api/admin/announcements?id=${id}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("Đã xoá");
      load();
    } else {
      toast.error(json.error ?? "Lỗi xoá");
    }
  }

  async function handleToggleActive(row: AnnouncementRow, next: boolean) {
    const res = await fetch(`/api/admin/announcements?id=${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, active: next }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success(next ? "Đã bật" : "Đã tắt");
      load();
    } else {
      toast.error(json.error ?? "Lỗi update");
    }
  }

  const active = rows.filter((r) => r.active);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Announcements</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {active.length} đang hiện · {rows.length} tổng cộng
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <AnnouncementDialog onSaved={load}>
            <Button size="sm">
              <Plus className="size-3.5" /> Mới
            </Button>
          </AnnouncementDialog>
        </div>
      </header>

      {rows.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <Megaphone className="size-8" />
            <p>Chưa có thông báo nào.</p>
            <AnnouncementDialog onSaved={load}>
              <Button size="sm" variant="outline">
                <Plus className="size-3.5" /> Tạo thông báo đầu tiên
              </Button>
            </AnnouncementDialog>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <AnnouncementCard
            key={row.id}
            row={row}
            onEdit={() => setEditTarget(row)}
            onDelete={() => handleDelete(row.id)}
            onToggleActive={(next) => handleToggleActive(row, next)}
          />
        ))}
      </div>

      {editTarget && (
        <AnnouncementDialog
          key={editTarget.id}
          target={editTarget}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
          open
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
        />
      )}

      {/* Mobile floating action button — same pattern as /codes + /keys.
          Reuses the create dialog via a second DialogTrigger. */}
      <AnnouncementDialog onSaved={load}>
        <Button
          className="fixed right-4 z-30 size-14 rounded-full shadow-lg md:hidden"
          style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
          aria-label="Tạo thông báo mới"
        >
          <Plus className="size-6" />
        </Button>
      </AnnouncementDialog>
    </div>
  );
}

function AnnouncementCard({
  row,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  row: AnnouncementRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  const expired = row.expiresAt && new Date(row.expiresAt) < new Date();
  return (
    <Card
      className={cn(
        "transition-opacity",
        (!row.active || expired) && "opacity-60",
      )}
    >
      <CardContent className="space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={row.severity} />
          {row.active ? (
            <Badge variant="default" className="text-[10px]">
              Đang hiện
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Tắt
            </Badge>
          )}
          {expired && (
            <Badge variant="destructive" className="text-[10px]">
              Hết hạn
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        </div>
        <h3 className="text-sm font-semibold">{row.title}</h3>
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {row.body}
        </p>
        {row.ctaLabel && row.ctaUrl && (
          <p className="text-[11px] text-primary">
            CTA: {row.ctaLabel} → {row.ctaUrl}
          </p>
        )}
        {row.expiresAt && (
          <p className="text-[10px] text-muted-foreground">
            Hết hạn: {new Date(row.expiresAt).toLocaleString()}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Bật
            <Switch
              checked={row.active}
              onCheckedChange={(v) => onToggleActive(Boolean(v))}
            />
          </label>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" /> Sửa
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const classes: Record<Severity, string> = {
    info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    critical: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        classes[severity],
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/**
 * Create / edit dialog. When `target` provided → edit mode. Otherwise
 * create. Same form for both — title, body, severity, optional CTA,
 * optional expiry, active toggle.
 */
function AnnouncementDialog({
  target,
  children,
  onSaved,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  target?: AnnouncementRow;
  children?: React.ReactElement;
  onSaved: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const [title, setTitle] = useState(target?.title ?? "");
  const [body, setBody] = useState(target?.body ?? "");
  const [severity, setSeverity] = useState<Severity>(target?.severity ?? "info");
  const [ctaLabel, setCtaLabel] = useState(target?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(target?.ctaUrl ?? "");
  const [active, setActive] = useState(target?.active ?? true);
  const [expiresAt, setExpiresAt] = useState(
    target?.expiresAt ? toLocalInputValue(new Date(target.expiresAt)) : "",
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error("Tiêu đề + nội dung bắt buộc");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        severity,
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
        active,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      const url = target
        ? `/api/admin/announcements?id=${target.id}`
        : "/api/admin/announcements";
      const res = await fetch(url, {
        method: target ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(target ? "Đã cập nhật" : "Đã tạo");
        onSaved();
        setOpen(false);
      } else {
        toast.error(json.error ?? "Lỗi");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger render={children} />}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {target ? "Sửa thông báo" : "Tạo thông báo mới"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div>
            <Label htmlFor="ann-title">Tiêu đề *</Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div>
            <Label htmlFor="ann-body">Nội dung *</Label>
            <Textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={4}
              required
            />
          </div>
          <div>
            <Label>Mức độ</Label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as Severity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">{SEVERITY_LABEL.info}</SelectItem>
                <SelectItem value="warn">{SEVERITY_LABEL.warn}</SelectItem>
                <SelectItem value="critical">
                  {SEVERITY_LABEL.critical}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="ann-cta-label">CTA label (optional)</Label>
              <Input
                id="ann-cta-label"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                maxLength={80}
                placeholder="Xem chi tiết"
              />
            </div>
            <div>
              <Label htmlFor="ann-cta-url">CTA URL (optional)</Label>
              <Input
                id="ann-cta-url"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                maxLength={500}
                placeholder="https://… hoặc /path"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ann-expires">Hết hạn (optional)</Label>
            <Input
              id="ann-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Để trống = không hết hạn (admin phải tắt thủ công).
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="ann-active" className="cursor-pointer">
              Bật ngay (hiển thị cho khách)
            </Label>
            <Switch
              id="ann-active"
              checked={active}
              onCheckedChange={(v) => setActive(Boolean(v))}
            />
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
              {busy ? "Đang lưu…" : target ? "Lưu thay đổi" : "Tạo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convert a Date to the format `<input type="datetime-local">` accepts
 * (YYYY-MM-DDTHH:mm in LOCAL timezone). The native date input has no
 * other way to be pre-populated with an existing value.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
