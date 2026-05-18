"use client";

import { useMemo, useState } from "react";
import { Plus, Copy, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

type Mode = "unlimited" | "quota" | "topup";

interface CreatedRow {
  id: string;
  code: string;
  customerLabel: string | null;
}

/**
 * Pattern-based bulk code creator. Admin enters prefix + start number
 * + count + quota + mode, dialog mints N codes in one transaction with
 * auto-numbered labels (e.g. "ABC-001"…"ABC-050").
 *
 * Why pattern over CSV: admin's actual workflow is "issue 50 codes for
 * this customer, all 10 EUR". CSV would force them to spreadsheet a
 * fake row 50 times for no extra control. Pattern handles the common
 * case in 4 fields.
 *
 * After mint, dialog shows the table of (label, code) pairs with two
 * export affordances:
 *   - "Copy all" → tab-separated to clipboard (paste into any sheet)
 *   - "Download .txt" → newline-separated, filename = `${prefix}-codes.txt`
 *
 * Capped at 200 codes per call by the API.
 */
export function BulkCreateCodeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [startNumber, setStartNumber] = useState("1");
  const [count, setCount] = useState("10");
  const [mode, setMode] = useState<Mode>("topup");
  const [quotaEur, setQuotaEur] = useState("10");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedRow[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Live preview — first 5 + last 5 labels so admin sees the padding
  // applied correctly before submitting (e.g. start=1 count=200 →
  // "ABC-001"…"ABC-200", not "ABC-1"…"ABC-200").
  const previewLabels = useMemo(() => {
    if (!prefix.trim()) return [];
    const start = Number(startNumber) || 1;
    const n = Number(count) || 0;
    if (n <= 0 || n > 200) return [];
    const last = start + n - 1;
    const width = String(last).length;
    const pad = (i: number) => String(i).padStart(width, "0");
    if (n <= 10) {
      return Array.from({ length: n }, (_, i) => `${prefix.trim()}-${pad(start + i)}`);
    }
    const first = Array.from({ length: 5 }, (_, i) => `${prefix.trim()}-${pad(start + i)}`);
    const tail = Array.from({ length: 5 }, (_, i) => `${prefix.trim()}-${pad(last - 4 + i)}`);
    return [...first, "...", ...tail];
  }, [prefix, startNumber, count]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedPrefix = prefix.trim();
    if (!trimmedPrefix) {
      toast.error("Prefix bắt buộc");
      return;
    }
    const startN = Number(startNumber);
    const cnt = Number(count);
    if (!Number.isFinite(startN) || startN < 0) {
      toast.error("Số bắt đầu phải >= 0");
      return;
    }
    if (!Number.isFinite(cnt) || cnt < 1 || cnt > 200) {
      toast.error("Số lượng phải 1-200");
      return;
    }
    const body: Record<string, unknown> = {
      prefix: trimmedPrefix,
      startNumber: startN,
      count: cnt,
      mode,
    };
    if (mode !== "unlimited") {
      const q = Number(quotaEur);
      if (!Number.isFinite(q) || q <= 0) {
        toast.error("Quota phải > 0");
        return;
      }
      body.quotaEur = q;
    }
    if (expiresInDays) {
      const d = Number(expiresInDays);
      if (!Number.isFinite(d) || d <= 0) {
        toast.error("Hết hạn sau N ngày phải > 0");
        return;
      }
      body.expiresInDays = d;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/codes/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Bulk create failed");
        return;
      }
      setCreated(json.created as CreatedRow[]);
      toast.success(`Đã tạo ${json.created.length} codes`);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCreated(null);
    setCopied(false);
    setPrefix("");
    setStartNumber("1");
    setCount("10");
    setQuotaEur("10");
    setExpiresInDays("");
    setMode("topup");
  }

  async function copyAll() {
    if (!created) return;
    // Tab-separated so paste into Excel/Google Sheets splits into 2 columns.
    const tsv = created
      .map((r) => `${r.customerLabel ?? ""}\t${r.code}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      toast.success("Đã copy vào clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy thất bại — dùng nút Download");
    }
  }

  function downloadTxt() {
    if (!created) return;
    const txt = created
      .map((r) => `${r.customerLabel ?? ""}: ${r.code}`)
      .join("\n");
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Filename uses prefix; fallback "codes" if state was reset somehow.
    const prefixForFile = prefix.trim() || "codes";
    a.download = `${prefixForFile}-${created.length}-codes.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          <Button size="sm" variant="outline">
            <Plus className="size-3.5" />
            Bulk create
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {created
              ? `Đã tạo ${created.length} codes`
              : "Tạo hàng loạt codes"}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <BulkCreatedView
            rows={created}
            onCopyAll={copyAll}
            onDownload={downloadTxt}
            copied={copied}
            onClose={() => setOpen(false)}
            onResetAndAddMore={reset}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div>
              <Label htmlFor="bc-prefix">Prefix *</Label>
              <Input
                id="bc-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="vd: ABC, 5-XuanHuy"
                maxLength={20}
                required
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Chỉ chữ, số, dấu &lsquo;-&rsquo;, &lsquo;_&rsquo;, &lsquo;.&rsquo;
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="bc-start">Số bắt đầu</Label>
                <Input
                  id="bc-start"
                  type="number"
                  min={0}
                  max={99999}
                  value={startNumber}
                  onChange={(e) => setStartNumber(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="bc-count">Số lượng *</Label>
                <Input
                  id="bc-count"
                  type="number"
                  min={1}
                  max={200}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  required
                />
              </div>
            </div>
            {previewLabels.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                <p className="mb-1 font-medium text-foreground/80">Preview:</p>
                <div className="flex flex-wrap gap-1 font-mono">
                  {previewLabels.map((label, i) => (
                    <span
                      key={`${label}-${i}`}
                      className={
                        label === "..."
                          ? "text-muted-foreground"
                          : "rounded bg-background px-1.5 py-0.5"
                      }
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="topup">Top-up (mặc định)</SelectItem>
                  <SelectItem value="quota">Quota cố định</SelectItem>
                  <SelectItem value="unlimited">Unlimited</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode !== "unlimited" && (
              <div>
                <Label htmlFor="bc-quota">Quota EUR mỗi code *</Label>
                <Input
                  id="bc-quota"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={quotaEur}
                  onChange={(e) => setQuotaEur(e.target.value)}
                  required
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Áp dụng cho tất cả {count || "?"} codes
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="bc-expires">Hết hạn sau N ngày (tuỳ chọn)</Label>
              <Input
                id="bc-expires"
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="trống = không hết hạn"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Đang tạo…" : `Tạo ${count || ""} codes`}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkCreatedView({
  rows,
  onCopyAll,
  onDownload,
  copied,
  onClose,
  onResetAndAddMore,
}: {
  rows: CreatedRow[];
  onCopyAll: () => void;
  onDownload: () => void;
  copied: boolean;
  onClose: () => void;
  onResetAndAddMore: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Lưu lại bảng dưới đây — codes sẽ không hiển thị lại sau khi đóng
        dialog. Customer dùng cột &ldquo;Code&rdquo; để activate; cột
        &ldquo;Nhãn&rdquo; chỉ là tên admin xem trong dashboard.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onCopyAll}>
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Đã copy" : "Copy all (TSV)"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDownload}>
          <Download className="size-3.5" />
          Download .txt
        </Button>
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-md border">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-muted/95">
            <tr>
              <th className="px-2 py-1.5 text-left">Nhãn</th>
              <th className="px-2 py-1.5 text-left">Code</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-2 py-1 font-medium">{r.customerLabel}</td>
                <td className="px-2 py-1 font-mono text-foreground/80">
                  {r.code}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onResetAndAddMore}>
          Tạo batch khác
        </Button>
        <Button size="sm" onClick={onClose}>
          Xong
        </Button>
      </div>
    </div>
  );
}
