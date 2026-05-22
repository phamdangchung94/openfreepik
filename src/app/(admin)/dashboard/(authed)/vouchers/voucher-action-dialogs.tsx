"use client";

import { useState } from "react";
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
import type { VoucherRow } from "./types";

/**
 * Two dialogs sharing a reason-input form. Both POST to the appropriate
 * admin endpoint and call onSuccess to refresh the list.
 *
 *   - Revoke: voucher is UNREDEEMED — soft-deletes so the redeem
 *     endpoint rejects future attempts.
 *   - Refund: voucher is REDEEMED — atomically deducts eur_value from
 *     the target activation code's quota_eur and flags voucher as
 *     refunded.
 */

interface DialogProps {
  voucher: VoucherRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RevokeVoucherDialog({
  voucher,
  onClose,
  onSuccess,
}: DialogProps) {
  return (
    <ReasonDialog
      voucher={voucher}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Huỷ voucher (revoke)"
      description="Voucher chưa redeem sẽ bị block redemption vĩnh viễn. Không hoàn tác được."
      submitLabel="Huỷ voucher"
      buildRequest={(id, reason) => ({
        url: `/api/admin/vouchers/${id}/revoke`,
        method: "PATCH",
        body: { reason },
      })}
    />
  );
}

export function RefundVoucherDialog({
  voucher,
  onClose,
  onSuccess,
}: DialogProps) {
  return (
    <ReasonDialog
      voucher={voucher}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Hoàn tiền voucher (refund)"
      description="Trừ EUR khỏi balance của activation code đã redeem (floored ở 0). Voucher sẽ không re-redeem được."
      submitLabel="Hoàn tiền"
      buildRequest={(id, reason) => ({
        url: `/api/admin/vouchers/${id}/refund`,
        method: "POST",
        body: { reason },
      })}
    />
  );
}

function ReasonDialog({
  voucher,
  onClose,
  onSuccess,
  title,
  description,
  submitLabel,
  buildRequest,
}: DialogProps & {
  title: string;
  description: string;
  submitLabel: string;
  buildRequest: (
    id: string,
    reason: string,
  ) => { url: string; method: "PATCH" | "POST"; body: object };
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!voucher) return;
    if (!reason.trim()) {
      toast.error("Cần nhập lý do (audit log)");
      return;
    }

    setSubmitting(true);
    try {
      const req = buildRequest(voucher.id, reason.trim());
      const res = await fetch(req.url, {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Thao tác thất bại");
        return;
      }
      toast.success("Đã cập nhật voucher");
      setReason("");
      onSuccess();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={!!voucher}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {voucher && (
          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">{description}</p>
            <div className="rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
              {voucher.code}
              <span className="ml-2 text-muted-foreground">
                ({voucher.tier} — {voucher.eurValue} €)
              </span>
            </div>
            <div>
              <Label htmlFor="reason">Lý do *</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="vd: Customer phàn nàn, in nhầm, lost card…"
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Huỷ
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={submitting}
              >
                {submitting ? "Đang xử lý…" : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
