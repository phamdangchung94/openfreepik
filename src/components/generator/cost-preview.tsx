"use client";

import { useFormContext } from "react-hook-form";
import { Coins, AlertCircle } from "lucide-react";
import { lookupCost, usePricingRates } from "@/hooks/use-pricing-rates";
import { useAuthStore } from "@/store/auth-store";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

interface CostPreviewProps {
  /**
   * Multiplier — used by batch flows to show per-item × count.
   * 1 in single mode; equals batchItems.length in batch mode.
   */
  count?: number;
}

/**
 * Real-time cost estimate that updates as the customer changes tier /
 * duration / audio. Lives just above the Generate button so the cost is
 * visible right when they're about to submit. Reads the same pricing
 * matrix the server uses (cached client-side via usePricingRates).
 *
 * Shows insufficient-balance warning if the next click would 402.
 */
export function CostPreview({ count = 1 }: CostPreviewProps) {
  const { watch } = useFormContext<GeneratorFormValues>();
  const tier = watch("tier");
  const duration = watch("duration");
  const audio = watch("generate_audio");

  const rates = usePricingRates();
  const metadata = useAuthStore((s) => s.metadata);

  if (!rates) {
    // Skeleton matches the loaded card's footprint (rounded-2xl + same
    // padding) so the layout doesn't shift when rates fetch resolves
    // (~30ms after first paint).
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Coins className="size-3.5 animate-pulse" />
        <span className="animate-pulse">Đang tính giá…</span>
      </div>
    );
  }

  const perItem = lookupCost(rates, {
    endpoint: "kling-v3",
    tier,
    durationSeconds: Number(duration),
    withAudio: !!audio,
  });

  if (perItem === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-500">
        <AlertCircle className="size-3.5" />
        <span>Chưa có giá cho cấu hình này — admin cần thêm.</span>
      </div>
    );
  }

  const total = perItem * count;
  const remaining = metadata?.remainingEur;
  const insufficient =
    remaining !== null && remaining !== undefined && total > remaining;

  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-xs transition-colors ${
        insufficient
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border bg-muted/30"
      }`}
    >
      <span className="flex items-center gap-2 text-muted-foreground">
        <Coins className="size-3.5" />
        {count > 1 ? (
          <>
            {count} × {perItem.toFixed(2)} EUR ={" "}
            <span className="font-mono font-medium text-foreground">
              {total.toFixed(2)} EUR
            </span>
          </>
        ) : (
          <>
            Chi phí dự kiến{" "}
            <span className="font-mono font-medium text-foreground">
              {total.toFixed(2)} EUR
            </span>
          </>
        )}
      </span>
      {insufficient && remaining !== null && remaining !== undefined && (
        <span className="text-amber-500">
          Cần thêm {(total - remaining).toFixed(2)} EUR
        </span>
      )}
      {!insufficient && metadata?.mode !== "unlimited" && remaining !== null && remaining !== undefined && (
        <span className="text-muted-foreground">
          Còn {remaining.toFixed(2)} EUR
        </span>
      )}
    </div>
  );
}
