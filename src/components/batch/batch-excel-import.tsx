"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { issueLabel, parseBatchFile, type ParsedBatchResult } from "@/lib/parse-batch-file";
import type { BatchItem } from "@/lib/form/generator-schema";
import { BatchSettings } from "./batch-settings";

const MAX_PROMPTS = 100;

interface BatchExcelImportProps {
  /** Notified whenever the parsed item list changes (cleared on reset). */
  onItemsChange: (items: BatchItem[]) => void;
}

export function BatchExcelImport({ onItemsChange }: BatchExcelImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedBatchResult | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        const result = await parseBatchFile(file);
        setParsed(result);
        setFilename(file.name);

        // Cap to MAX_PROMPTS, surface a one-time toast if we trimmed.
        const capped = result.prompts.slice(0, MAX_PROMPTS);
        if (result.prompts.length > MAX_PROMPTS) {
          toast.warning(
            `File có ${result.prompts.length} prompt — chỉ chạy ${MAX_PROMPTS} dòng đầu.`,
          );
        }

        const items: BatchItem[] = capped.map((p) => ({
          // Stable id ties to row number so retry-failed-rows can match later.
          id: `xlsx-row-${p.rowNumber}-${Math.random().toString(36).slice(2, 8)}`,
          mode: "t2v",
          prompt: p.prompt,
        }));
        onItemsChange(items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Không đọc được file.";
        toast.error(msg);
        setParsed(null);
        setFilename(null);
        onItemsChange([]);
      } finally {
        setParsing(false);
      }
    },
    [onItemsChange],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function reset() {
    setParsed(null);
    setFilename(null);
    onItemsChange([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const validCount = Math.min(parsed?.prompts.length ?? 0, MAX_PROMPTS);

  return (
    <div className="space-y-3">
      {!parsed && (
        <div
          role="button"
          tabIndex={parsing ? -1 : 0}
          aria-label="Tải file Excel hoặc CSV"
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-6 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            parsing && "opacity-50 cursor-not-allowed",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !parsing && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (parsing) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          {parsing ? (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Đang đọc file...</p>
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Kéo thả file Excel/CSV hoặc bấm để chọn
              </p>
              <p className="text-xs text-muted-foreground">
                .xlsx hoặc .csv · header:{" "}
                <code className="font-mono">STT | Prompt</code> · tối đa{" "}
                {MAX_PROMPTS} dòng
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            disabled={parsing}
          />
        </div>
      )}

      {parsed && (
        <div className="space-y-3 rounded-3xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{filename}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={reset}
              title="Bỏ file, chọn lại"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Badge
              variant="secondary"
              className="gap-1 bg-primary/10 text-primary"
            >
              <CheckCircle2 className="size-3" />
              {validCount} prompt hợp lệ
            </Badge>
            {parsed.issues.length > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3" />
                {parsed.issues.length} dòng bỏ qua
              </Badge>
            )}
          </div>

          {/* First-5 preview */}
          {validCount > 0 && (
            <ScrollArea className="max-h-[180px] rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr>
                    <th className="w-10 px-2 py-1 text-left font-medium">STT</th>
                    <th className="px-2 py-1 text-left font-medium">Prompt</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.prompts.slice(0, 5).map((p) => (
                    <tr key={p.rowNumber} className="border-t">
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {p.rowNumber}
                      </td>
                      <td className="px-2 py-1">
                        <span className="line-clamp-1">{p.prompt}</span>
                      </td>
                    </tr>
                  ))}
                  {validCount > 5 && (
                    <tr className="border-t">
                      <td
                        colSpan={2}
                        className="px-2 py-1.5 text-center text-muted-foreground"
                      >
                        …và {validCount - 5} dòng nữa
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          )}

          {/* Issues breakdown — collapsed list of skipped rows */}
          {parsed.issues.length > 0 && (
            <details className="rounded-md border bg-destructive/5 p-2">
              <summary className="cursor-pointer text-xs text-destructive">
                Xem {parsed.issues.length} dòng bị bỏ qua
              </summary>
              <ul className="mt-2 space-y-0.5 text-[11px] text-destructive/80">
                {parsed.issues.slice(0, 20).map((iss, i) => (
                  <li key={i}>
                    Dòng {iss.rowNumber}: {issueLabel(iss.reason)}
                  </li>
                ))}
                {parsed.issues.length > 20 && (
                  <li className="text-muted-foreground">
                    …và {parsed.issues.length - 20} dòng nữa
                  </li>
                )}
              </ul>
            </details>
          )}

          <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Cài đặt áp dụng cho cả {validCount} video
            </span>
            <BatchSettings />
          </div>
        </div>
      )}
    </div>
  );
}
