"use client";

import { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Output duration display + auto-derivation for Kling Motion.
 *
 * Magnific has no `duration` request field — output length tracks the
 * reference video. Customer doesn't pick anything; we just:
 *   1. Read `motion_video_duration` (set by motion-video-picker after
 *      <video> metadata loads).
 *   2. Snap to the nearest pricing tier ceiling: 5 / 10 / 15 / 30.
 *   3. Clamp to the orientation cap (image → 10s max, video → 30s).
 *   4. Write back to `output_duration` so the cost preview + POST
 *      payload pick up the chosen tier.
 *
 * UX: badge shows the auto-derived tier; copy explains why and what
 * orientation cap does.
 *
 * Why ceiling (not floor or round): under-charging would surprise us
 * if Magnific generates the full reference length; over-charging by
 * one tier is acceptable customer-side because we're matching a
 * discrete price ladder, not pro-rating per-second.
 */

const TIERS = [5, 10, 15, 30] as const;
type TierString = "5" | "10" | "15" | "30";

/** Map a continuous duration in seconds → the nearest pricing tier ceiling. */
function tierForDuration(
  seconds: number,
  orientation: "video" | "image",
): TierString {
  // Orientation=image caps the upstream output at 10s, so even if
  // someone uploads a 25s reference video, we charge at most 10s.
  const cap = orientation === "image" ? 10 : 30;
  const effective = Math.min(Math.max(seconds, 0), cap);
  for (const t of TIERS) {
    if (t > cap) break; // skip tiers above orientation cap
    if (effective <= t) return String(t) as TierString;
  }
  return String(cap) as TierString;
}

export function MotionOutputDurationPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const detectedSeconds = watch("motion_video_duration");
  const orientation = watch("motion_orientation");
  const current = watch("output_duration");

  // Auto-derive output_duration from detected video length + orientation
  // cap. Runs every time the detection or orientation changes. Skip if
  // no video uploaded yet (detectedSeconds=0).
  useEffect(() => {
    if (!detectedSeconds || detectedSeconds <= 0) return;
    const next = tierForDuration(detectedSeconds, orientation);
    if (next !== current) {
      setValue("output_duration", next, { shouldDirty: true });
    }
  }, [detectedSeconds, orientation, current, setValue]);

  const hasVideo = detectedSeconds > 0;
  const cap = orientation === "image" ? 10 : 30;
  const wasCapped = hasVideo && detectedSeconds > cap;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Thời lượng output</Label>
      {hasVideo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <Clock className="size-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {current}s
          </span>
          <span className="text-muted-foreground">
            (tự động theo video tham chiếu —{" "}
            {detectedSeconds.toFixed(1)}s)
          </span>
          {wasCapped && (
            <span className="text-amber-500">
              · giới hạn ở {cap}s vì &ldquo;Theo {orientation === "image" ? "Ảnh" : "Video"}&rdquo;
            </span>
          )}
        </div>
      ) : (
        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Upload video tham chiếu để hệ thống tự xác định thời lượng output.
        </p>
      )}
    </div>
  );
}
