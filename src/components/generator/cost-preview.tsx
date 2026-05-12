"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Coins, AlertCircle } from "lucide-react";
import { lookupCost, usePricingRates } from "@/hooks/use-pricing-rates";
import { useAuthStore } from "@/store/auth-store";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";
import { formatVnd } from "@/lib/format-currency";

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
  const model = watch("model");
  const mode = watch("mode");
  const tier = watch("tier");
  const resolution = watch("resolution");
  const duration = watch("duration");
  const audio = watch("generate_audio");

  const rates = usePricingRates();
  const metadata = useAuthStore((s) => s.metadata);

  // Memoize the lookup — `lookupCost` walks the rates array; with batch
  // count=100 this component re-renders on every form keystroke. Note:
  // hooks must precede every early return below (Rules of Hooks).
  //
  // Model branch: WAN encodes resolution into the tier slot of the
  // pricing table (std=720P, pro=1080P) and ignores audio entirely;
  // see lookupForWanV27 in lib/pricing/calculator.ts.
  const perItem = useMemo(() => {
    if (!rates) return null;
    if (model === "wan-v27") {
      return lookupCost(rates, {
        endpoint: "wan-v27",
        tier: resolution === "720P" ? "std" : "pro",
        durationSeconds: Number(duration),
        withAudio: false,
      });
    }
    // Kling 3 — tier='4k' routes to the kling-4k-* pricing rows
    // (matching the request endpoint); Pro/Std stay on kling-v3.
    if (tier === "4k") {
      return lookupCost(rates, {
        endpoint: mode === "t2v" ? "kling-4k-t2v" : "kling-4k-i2v",
        tier: "4k",
        durationSeconds: Number(duration),
        withAudio: !!audio,
      });
    }
    return lookupCost(rates, {
      endpoint: "kling-v3",
      tier,
      durationSeconds: Number(duration),
      withAudio: !!audio,
    });
  }, [rates, model, mode, tier, resolution, duration, audio]);

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
            {count} × {formatVnd(perItem)} ={" "}
            <span className="font-mono font-medium text-foreground">
              {formatVnd(total)}
            </span>
          </>
        ) : (
          <>
            Chi phí dự kiến{" "}
            <span className="font-mono font-medium text-foreground">
              {formatVnd(total)}
            </span>
          </>
        )}
      </span>
      {insufficient && remaining !== null && remaining !== undefined && (
        <span className="text-amber-500">
          Cần thêm {formatVnd(total - remaining)}
        </span>
      )}
      {!insufficient && metadata?.mode !== "unlimited" && remaining !== null && remaining !== undefined && (
        <span className="text-muted-foreground">
          Còn {formatVnd(remaining)}
        </span>
      )}
    </div>
  );
}
