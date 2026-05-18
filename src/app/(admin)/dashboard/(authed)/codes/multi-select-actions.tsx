"use client";

import { useState } from "react";
import { Ban, RotateCcw, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Floating action bar — shown when admin has selected one or more codes
 * via the checkboxes on the codes page. Three batched ops:
 *
 *   - Revoke selected     → POST bulk-action {action: "revoke"}
 *   - Reactivate selected → POST bulk-action {action: "reactivate"}
 *   - Top up selected     → opens dialog → POST bulk-action {action: "topup", amount}
 *
 * "Top up" only affects `mode='topup'` codes server-side; the response
 * reports `requested` vs `updated` so admin sees how many were skipped.
 *
 * Designed to live OUTSIDE the table — sticky-positioned at top so it
 * stays visible while admin scrolls a long list. Hides itself when no
 * codes are selected.
 */
export function MultiSelectActions({
  selectedIds,
  onClear,
  onChanged,
}: {
  selectedIds: Set<string>;
  onClear: () => void;
  onChanged: () => void;
}) {
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("10");
  const [busy, setBusy] = useState(false);

  if (selectedIds.size === 0) return null;

  async function bulkAction(action: "revoke" | "reactivate") {
    const ids = [...selectedIds];
    const label = action === "revoke" ? "thu hồi" : "khôi phục";
    if (!confirm(`Xác nhận ${label} ${ids.length} code?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/codes/bulk-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? `${label} thất bại`);
        return;
      }
      toast.success(`Đã ${label} ${json.updated}/${json.requested} codes`);
      onChanged();
      onClear();
    } finally {
      setBusy(false);
    }
  }

  async function handleTopup(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Số tiền phải > 0");
      return;
    }
    const ids = [...selectedIds];
    setBusy(true);
    try {
      const res = await fetch("/api/admin/codes/bulk-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "topup", ids, amount }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Top up thất bại");
        return;
      }
      const skipped = json.skipped ?? 0;
      const skipNote =
        skipped > 0 ? ` (${skipped} không phải topup-mode, đã skip)` : "";
      toast.success(
        `Đã top up ${amount} EUR cho ${json.updated}/${json.requested} codes${skipNote}`,
      );
      setTopupOpen(false);
      setTopupAmount("10");
      onChanged();
      onClear();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 mb-2 flex flex-wrap items-center gap-2 border-y bg-primary/10 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <span className="text-sm font-medium">
          {selectedIds.size} đã chọn
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkAction("revoke")}
            disabled={busy}
          >
            <Ban className="size-3.5" /> Revoke
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulkAction("reactivate")}
            disabled={busy}
          >
            <RotateCcw className="size-3.5" /> Reactivate
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTopupOpen(true)}
            disabled={busy}
          >
            <Plus className="size-3.5" /> Top up
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={busy}
            title="Bỏ chọn tất cả"
            className="size-7 [&_svg]:size-3.5"
          >
            <X />
          </Button>
        </div>
      </div>

      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Top up {selectedIds.size} codes</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTopup} className="space-y-3 text-sm">
            <div>
              <Label htmlFor="bulk-topup-amount">Số tiền (EUR) mỗi code</Label>
              <Input
                id="bulk-topup-amount"
                type="number"
                step="0.01"
                min={0.01}
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                required
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Chỉ áp dụng cho codes mode <span className="font-mono">topup</span>.
                Codes mode quota/unlimited sẽ skip.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTopupOpen(false)}
                disabled={busy}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Đang top up…" : "Xác nhận"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
