"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { BatchItem } from "@/lib/form/generator-schema";
import { uploadImageToHost } from "@/lib/upload/image-host";

interface BatchUploadZoneProps {
  items: BatchItem[];
  onAddItems: (items: BatchItem[]) => void;
  onRemoveItem: (id: string) => void;
  onUpdatePrompt: (id: string, prompt: string) => void;
  defaultPrompt?: string;
  disabled?: boolean;
}

export function BatchUploadZone({
  items,
  onAddItems,
  onRemoveItem,
  onUpdatePrompt,
  defaultPrompt = "",
  disabled = false,
}: BatchUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const validFiles: File[] = [];
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) continue;
        validFiles.push(file);
      }
      if (validFiles.length === 0) return;

      setIsUploading(true);

      try {
        // Upload directly from browser to litterbox (bypasses Vercel 4.5MB body limit)
        const uploaded = await Promise.all(
          validFiles.map((file) => uploadImageToHost(file)),
        );

        const newItems: BatchItem[] = uploaded.map((u, i) => ({
          id: crypto.randomUUID(),
          file: validFiles[i],
          previewUrl: u.dataUri,
          imageUrl: u.publicUrl,
          prompt: defaultPrompt,
          filename: validFiles[i]?.name ?? u.filename,
        }));

        onAddItems(newItems);
      } catch (err) {
        console.error("[batch-upload] Error:", err);
        alert(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [defaultPrompt, onAddItems],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const isDisabled = disabled || isUploading;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          isDisabled && "opacity-50 cursor-not-allowed",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isDisabled && inputRef.current?.click()}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Uploading images...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag & drop images here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground/70">
              JPG, PNG, WebP — max 10MB each, up to 20 files
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={isDisabled}
        />
      </div>

      {/* Image list with per-image prompts */}
      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{items.length} images</Badge>
          </div>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-2">
              {items.map((item) => (
                <BatchItemCard
                  key={item.id}
                  item={item}
                  onRemove={() => onRemoveItem(item.id)}
                  onUpdatePrompt={(p) => onUpdatePrompt(item.id, p)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function BatchItemCard({
  item,
  onRemove,
  onUpdatePrompt,
}: {
  item: BatchItem;
  onRemove: () => void;
  onUpdatePrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-card p-2.5">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt={item.filename}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {item.filename}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Textarea
          rows={2}
          placeholder="Custom prompt for this image..."
          value={item.prompt}
          onChange={(e) => onUpdatePrompt(e.target.value)}
          className="text-xs min-h-[48px]"
        />
      </div>
    </div>
  );
}
