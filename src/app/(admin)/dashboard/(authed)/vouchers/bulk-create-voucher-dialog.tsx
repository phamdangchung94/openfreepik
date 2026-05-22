"use client";

import { useState } from "react";
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
import type { VoucherTier } from "./types";

interface CreatedVoucher {
  id: string;
  code: string;
  tier: VoucherTier;
  vndValue: number;
  eurValue: string;
  batchLabel: string | null;
}

/**
 * Bulk-mint dialog for vouchers. Picks ONE tier per batch (admin's
 * actual flow: "issue 50× 200k vouchers for Tet promo" not "mix and
 * match"). Optional batchLabel groups the mint for later filtering.
 *
 * After mint, codes are shown ONCE — admin must Copy/Download before
 * closing. The code is permanent and not re-displayed; admin can
 * always look up by id later but won't get the formatted print view.
 */
export function BulkCreateVoucherDialog({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState<VoucherTier>("100k");
  const [count, setCount] = useState("10");
  const [batchLabel, setBatchLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedVoucher[] | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cnt = Number(count);
    if (!Number.isFinite(cnt) || cnt < 1 || cnt > 200) {
      toast.error("Số lượng phải 1-200");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/vouchers/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          count: cnt,
          batchLabel: batchLabel.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Bulk create failed");
        return;
      }
      setCreated(json.created as CreatedVoucher[]);
      toast.success(`Đã tạo ${json.created.length} vouchers ${tier}`);
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCreated(null);
    setCopied(false);
    setTier("100k");
    setCount("10");
    setBatchLabel("");
  }

  async function copyAll() {
    if (!created) return;
    // One code per line — admin will paste into Zalo / printed cards.
    const text = created.map((r) => r.code).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Đã copy vào clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy thất bại — dùng nút Download");
    }
  }

  function downloadTxt() {
    if (!created) return;
    const txt = created.map((r) => r.code).join("\n");
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const labelForFile = batchLabel.trim() || `voucher-${tier}`;
    a.download = `${labelForFile}-${created.length}-codes.txt`;
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
          <Button size="sm">
            <Plus className="size-3.5" />
            Mint vouchers
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {created
              ? `Đã mint ${created.length} vouchers`
              : "Mint vouchers (mã nạp tiền)"}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <CreatedView
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
              <Label htmlFor="bv-tier">Mệnh giá *</Label>
              <Select
                value={tier}
                onValueChange={(v) => setTier(v as VoucherTier)}
              >
                <SelectTrigger id="bv-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100k">100.000 đ → +100 €</SelectItem>
                  <SelectItem value="200k">200.000 đ → +200 €</SelectItem>
                  <SelectItem value="500k">500.000 đ → +500 €</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="bv-count">Số lượng *</Label>
              <Input
                id="bv-count"
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                required
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Tối đa 200 / lần
              </p>
            </div>
            <div>
              <Label htmlFor="bv-label">Batch label (tuỳ chọn)</Label>
              <Input
                id="bv-label"
                value={batchLabel}
                onChange={(e) => setBatchLabel(e.target.value)}
                placeholder="vd: T11-2026-AnhA"
                maxLength={60}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Để filter sau này. Để trống nếu không cần group.
              </p>
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
                {submitting ? "Đang tạo…" : `Mint ${count || ""} ${tier}`}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreatedView({
  rows,
  onCopyAll,
  onDownload,
  copied,
  onClose,
  onResetAndAddMore,
}: {
  rows: CreatedVoucher[];
  onCopyAll: () => void;
  onDownload: () => void;
  copied: boolean;
  onClose: () => void;
  onResetAndAddMore: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        ⚠️ Lưu codes ngay — sau khi đóng dialog không xem lại được full
        code, chỉ còn 6 ký tự cuối trong list.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onCopyAll}>
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Đã copy" : "Copy all"}
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
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Code</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1 font-mono text-foreground/90">
                  {r.code}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onResetAndAddMore}>
          Mint batch khác
        </Button>
        <Button size="sm" onClick={onClose}>
          Xong
        </Button>
      </div>
    </div>
  );
}
