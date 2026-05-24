"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Pricing table — embedded near the top of /docs/api. Synced manually
 * with the production `pricing_rules` table on every doc update.
 *
 * Source of truth: SELECT * FROM pricing_rules. If you touch this,
 * also touch `src/app/api/v1/models/route.ts` and `ai-prompt.ts` to
 * keep the 3-way docs / API / AI-prompt mirror in sync.
 */

interface Row {
  id: string;
  family: string;
  eurPerSecond: number;
  eurPerSecondAudio?: number; // omit if audio doesn't change pricing
  audioNote?: string;
  notes?: string;
}

const ROWS: readonly Row[] = [
  { id: "Kling 3 Std", family: "kling-v3", eurPerSecond: 0.168, eurPerSecondAudio: 0.308 },
  { id: "Kling 3 Pro", family: "kling-v3", eurPerSecond: 0.224, eurPerSecondAudio: 0.392 },
  { id: "Kling 3 4K T2V", family: "kling-3-4k-text", eurPerSecond: 1.12, audioNote: "audio same price" },
  { id: "Kling 3 4K I2V", family: "kling-3-4k-image", eurPerSecond: 1.12, audioNote: "audio same price" },
  { id: "Motion 2.6 Std", family: "kling-motion-v2-6-std", eurPerSecond: 0.138, audioNote: "no audio" },
  { id: "Motion 2.6 Pro", family: "kling-motion-v2-6-pro", eurPerSecond: 0.276, audioNote: "no audio" },
  { id: "Motion 3.0 Std", family: "kling-motion-v3-std", eurPerSecond: 0.294, audioNote: "no audio" },
  { id: "Motion 3.0 Pro", family: "kling-motion-v3-pro", eurPerSecond: 0.394, audioNote: "no audio" },
  { id: "Omni Std", family: "kling-omni-std", eurPerSecond: 0.168, eurPerSecondAudio: 0.308 },
  { id: "Omni Pro", family: "kling-omni-pro", eurPerSecond: 0.224, eurPerSecondAudio: 0.392 },
  { id: "Prompt enhance", family: "improve-prompt", eurPerSecond: 0, audioNote: "free" },
];

function eur(value: number): string {
  if (value === 0) return "—";
  return `${value.toFixed(3)} €`;
}

function vnd(eurValue: number): string {
  if (eurValue === 0) return "—";
  return `${Math.round(eurValue * 1000).toLocaleString("vi-VN")}đ`;
}

function exampleCost(rate: number, seconds: number): string {
  if (rate === 0) return "—";
  const cost = rate * seconds;
  return `${cost.toFixed(2)} € (${Math.round(cost * 1000).toLocaleString("vi-VN")}đ)`;
}

export function PricingTable() {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
      >
        <span>
          Bảng giá đầy đủ{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (per-second, 1 EUR ≈ 1.000đ)
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="overflow-x-auto border-t bg-background/40 p-3">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Model / Tier</th>
                <th className="px-2 py-1.5 text-right font-medium">€/giây</th>
                <th className="px-2 py-1.5 text-right font-medium">VND/giây</th>
                <th className="px-2 py-1.5 text-right font-medium">+ audio €/giây</th>
                <th className="px-2 py-1.5 text-right font-medium">5s no-audio</th>
                <th className="px-2 py-1.5 text-right font-medium">10s no-audio</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.family} className="border-b border-muted/40 last:border-0">
                  <td className="py-1 pr-3">
                    <div>{row.id}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {row.family}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(row.eurPerSecond)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                    {vnd(row.eurPerSecond)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {row.eurPerSecondAudio !== undefined
                      ? eur(row.eurPerSecondAudio)
                      : (
                        <span className="text-[10px] text-muted-foreground">
                          {row.audioNote}
                        </span>
                      )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {exampleCost(row.eurPerSecond, 5)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {exampleCost(row.eurPerSecond, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Cách tính: <code className="font-mono">cost = ceil(duration_seconds) × rate</code>.
            Multi-shot (Kling 3) bill tổng duration các shot cộng lại.
            Refund tự động khi task FAILED/TIMEOUT.{" "}
            <Link
              href="/pricing"
              className="inline-flex items-center gap-0.5 underline hover:text-foreground"
            >
              Bảng giá customer-facing <ExternalLink className="size-2.5" />
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
