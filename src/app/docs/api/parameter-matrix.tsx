"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Parameter matrix table — collapsed at the top of /docs/api so
 * developers can scan "which endpoint supports which param" without
 * jumping between sections.
 *
 * Data source: hand-extracted from `src/lib/freepik/*-schema.ts`. Kept
 * static (not generated from Zod) to keep the matrix readable and to
 * let us add human notes ("V2V only", "interpolation pair") per cell.
 *
 * Cell legend:
 *   ★ required
 *   ✓ optional
 *   — not supported on this endpoint
 */

type Cell = "required" | "optional" | "no";

interface EndpointRow {
  id: string;
  label: string;
  prompt: Cell;
  negativePrompt: Cell;
  image: Cell;
  startEndFrame: Cell;
  multiShot: Cell;
  elements: Cell;
  videoUrl: Cell;
  duration: Cell;
  aspectRatio: Cell;
  generateAudio: Cell;
  cfgScale: Cell;
  webhookUrl: Cell;
  notes?: string;
}

const ROWS: readonly EndpointRow[] = [
  {
    id: "kling-3",
    label: "POST /v1/video/kling-3",
    prompt: "optional",
    negativePrompt: "optional",
    image: "optional",
    startEndFrame: "optional",
    multiShot: "optional",
    elements: "optional",
    videoUrl: "no",
    duration: "optional",
    aspectRatio: "optional",
    generateAudio: "optional",
    cfgScale: "optional",
    webhookUrl: "optional",
    notes: "Endpoint mạnh nhất — 5 mode trong 1 body shape",
  },
  {
    id: "kling-3-4k-text",
    label: "POST /v1/video/kling-3-4k-text",
    prompt: "required",
    negativePrompt: "optional",
    image: "no",
    startEndFrame: "no",
    multiShot: "no",
    elements: "no",
    videoUrl: "no",
    duration: "optional",
    aspectRatio: "optional",
    generateAudio: "optional",
    cfgScale: "optional",
    webhookUrl: "optional",
    notes: "4K T2V — audio không đổi giá",
  },
  {
    id: "kling-3-4k-image",
    label: "POST /v1/video/kling-3-4k-image",
    prompt: "optional",
    negativePrompt: "optional",
    image: "required",
    startEndFrame: "no",
    multiShot: "no",
    elements: "no",
    videoUrl: "no",
    duration: "optional",
    aspectRatio: "no",
    generateAudio: "optional",
    cfgScale: "optional",
    webhookUrl: "optional",
    notes: "4K I2V — bắt buộc image",
  },
  {
    id: "kling-motion",
    label: "POST /v1/video/kling-motion/{tier}",
    prompt: "optional",
    negativePrompt: "no",
    image: "required",
    startEndFrame: "no",
    multiShot: "no",
    elements: "no",
    videoUrl: "required",
    duration: "required",
    aspectRatio: "no",
    generateAudio: "no",
    cfgScale: "optional",
    webhookUrl: "optional",
    notes: "image_url (character) + video_url (motion reference) + output_duration",
  },
  {
    id: "prompt-improve",
    label: "POST /v1/prompt/improve",
    prompt: "required",
    negativePrompt: "no",
    image: "no",
    startEndFrame: "no",
    multiShot: "no",
    elements: "no",
    videoUrl: "no",
    duration: "no",
    aspectRatio: "no",
    generateAudio: "no",
    cfgScale: "no",
    webhookUrl: "optional",
    notes: "Free — body cần thêm type: image|video + language?",
  },
  {
    id: "upload",
    label: "POST /v1/upload",
    prompt: "no",
    negativePrompt: "no",
    image: "no",
    startEndFrame: "no",
    multiShot: "no",
    elements: "no",
    videoUrl: "no",
    duration: "no",
    aspectRatio: "no",
    generateAudio: "no",
    cfgScale: "no",
    webhookUrl: "no",
    notes: "Body riêng: { filename, contentType, size, kind: image|video }",
  },
] as const;

const COLUMNS: { key: keyof EndpointRow; label: string }[] = [
  { key: "prompt", label: "prompt" },
  { key: "negativePrompt", label: "negative_prompt" },
  { key: "image", label: "image" },
  { key: "startEndFrame", label: "start/end_image_url" },
  { key: "multiShot", label: "multi_shot[]" },
  { key: "elements", label: "elements[]" },
  { key: "videoUrl", label: "video_url" },
  { key: "duration", label: "duration" },
  { key: "aspectRatio", label: "aspect_ratio" },
  { key: "generateAudio", label: "generate_audio" },
  { key: "cfgScale", label: "cfg_scale" },
  { key: "webhookUrl", label: "webhook_url" },
];

function cellGlyph(value: Cell): { glyph: string; className: string } {
  if (value === "required")
    return { glyph: "★", className: "text-amber-600 dark:text-amber-400 font-semibold" };
  if (value === "optional")
    return { glyph: "✓", className: "text-emerald-600 dark:text-emerald-400" };
  return { glyph: "—", className: "text-muted-foreground/40" };
}

export function ParameterMatrix() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
      >
        <span>
          Bảng tham số tất cả endpoints{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (★ bắt buộc · ✓ tuỳ chọn · — không support)
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="overflow-x-auto border-t bg-background/40 p-3">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b text-left">
                <th className="sticky left-0 bg-background/95 py-1.5 pr-2 font-medium">
                  Endpoint
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="px-1.5 py-1.5 text-center font-mono font-normal text-muted-foreground"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.id} className="border-b border-muted/40 last:border-0">
                  <td className="sticky left-0 bg-background/95 py-1 pr-2 font-mono">
                    <a
                      href={`#${row.id}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {row.label}
                    </a>
                  </td>
                  {COLUMNS.map((col) => {
                    const v = row[col.key] as Cell;
                    const { glyph, className } = cellGlyph(v);
                    return (
                      <td
                        key={col.key}
                        className={cn("px-1.5 py-1 text-center", className)}
                        title={
                          v === "required"
                            ? "Bắt buộc"
                            : v === "optional"
                              ? "Tuỳ chọn"
                              : "Không support"
                        }
                      >
                        {glyph}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 space-y-0.5 text-[10px] text-muted-foreground">
            {ROWS.filter((r) => r.notes).map((r) => (
              <li key={r.id}>
                <span className="font-mono text-foreground/80">{r.id}</span>: {r.notes}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
