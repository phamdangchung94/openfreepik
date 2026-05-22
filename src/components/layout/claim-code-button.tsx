"use client";

import { useCallback, useEffect, useState } from "react";
import { Ticket, History as HistoryIcon, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuthStore, type BalanceUpdate } from "@/store/auth-store";
import { formatVnd } from "@/lib/format-currency";

/**
 * Customer-side "Claim Code" — opens a dialog where the customer pastes
 * a voucher code (CODE-100-XXXXXXXX / 200 / 500) to add EUR balance to
 * their activation code's quota.
 *
 * Renders only when an activation code is active (gated by store state).
 *
 * On successful redeem:
 *   - Toast confirms with the new balance
 *   - Auth store metadata gets `mergeBalance(...)` so the header chip
 *     refreshes without a roundtrip
 *   - History list (collapsible inside the dialog) re-fetches
 */

interface HistoryEntry {
  id: string;
  maskedCode: string;
  tier: "100k" | "200k" | "500k";
  vndValue: number;
  eurValue: number;
  redeemedAt: string;
  refundedAt: string | null;
}

export function ClaimCodeButton() {
  const activationCode = useAuthStore((s) => s.activationCode);
  const metadata = useAuthStore((s) => s.metadata);

  // Hide entirely when not activated — there's no useful action.
  if (!activationCode || !metadata) return null;

  // Hide for unlimited-mode codes — they can't be credited.
  if (metadata.mode === "unlimited") return null;

  return <ClaimDialog activationCode={activationCode} />;
}

function ClaimDialog({ activationCode }: { activationCode: string }) {
  const mergeBalance = useAuthStore((s) => s.mergeBalance);

  const [open, setOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/redeem-voucher", {
        headers: { Authorization: `Bearer ${activationCode}` },
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setHistory(json.history as HistoryEntry[]);
      }
    } catch {
      // Best-effort — fail silently. The history is a nice-to-have,
      // not a blocker.
    }
  }, [activationCode]);

  // Lazy-load history the first time the dialog opens.
  useEffect(() => {
    if (open && history === null) {
      void fetchHistory();
    }
  }, [open, history, fetchHistory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = voucherCode.trim();
    if (!code) {
      toast.error("Nhập mã trước.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/redeem-voucher", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activationCode}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Nạp mã thất bại");
        return;
      }
      // Push new balance into the store so the header chip refreshes
      // immediately without a separate /api/activate roundtrip.
      const balance = json.balance as BalanceUpdate;
      mergeBalance(balance);
      toast.success(
        `Đã nạp +${json.eurValue} € (${formatVnd(json.eurValue)})`,
      );
      setVoucherCode("");
      // Refresh history so the new redemption shows up.
      void fetchHistory();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            title="Nạp tiền bằng voucher code"
          >
            <Ticket className="size-3.5 text-emerald-500" />
            <span className="hidden sm:inline">Claim Code</span>
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="size-4 text-emerald-500" />
            Nạp tiền — Claim Code
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <form onSubmit={handleSubmit} className="space-y-2">
            <Input
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              placeholder="CODE-100-XXXXXXXX"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              disabled={submitting}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Định dạng: <code className="font-mono">CODE-100-XXXX</code>,
              <code className="ml-1 font-mono">CODE-200-XXXX</code>, hoặc{" "}
              <code className="font-mono">CODE-500-XXXX</code>. Voucher chỉ
              dùng được 1 lần.
            </p>
            <Button
              type="submit"
              className="w-full gap-1.5"
              disabled={submitting}
            >
              {submitting ? (
                "Đang nạp…"
              ) : (
                <>
                  <Plus className="size-3.5" />
                  Nạp vào tài khoản
                </>
              )}
            </Button>
          </form>

          {history && history.length > 0 && (
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <CollapsibleTrigger
                render={
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
                  >
                    <span className="flex items-center gap-1.5">
                      <HistoryIcon className="size-3.5" />
                      Lịch sử nạp ({history.length})
                    </span>
                    <span className="text-[10px]">
                      {historyOpen ? "Ẩn" : "Xem"}
                    </span>
                  </button>
                }
              />
              <CollapsibleContent className="mt-2">
                <ul className="divide-y rounded-md border text-[11px]">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                    >
                      <div>
                        <p className="font-mono text-foreground/80">
                          {h.maskedCode}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(h.redeemedAt).toLocaleString("vi-VN")}
                          {h.refundedAt && " · đã hoàn"}
                        </p>
                      </div>
                      <span
                        className={`font-medium ${h.refundedAt ? "text-muted-foreground line-through" : "text-emerald-600 dark:text-emerald-400"}`}
                      >
                        +{h.eurValue} €
                      </span>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}

          {history && history.length === 0 && (
            <p className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <Check className="mr-1 inline size-3" />
              Chưa có lịch sử nạp.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
