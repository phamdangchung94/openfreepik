"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Upload, X, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadImageToHost } from "@/lib/upload/image-host";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FrameSlotProps {
  label: string;
  required?: boolean;
  url: string;
  localPreview: string;
  onUploaded: (publicUrl: string, dataUri: string) => void;
  onClear: () => void;
}

function FrameSlot({
  label,
  required,
  url,
  localPreview,
  onUploaded,
  onClear,
}: FrameSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Only images allowed");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("Max 10MB");
        return;
      }
      setError(null);
      setIsUploading(true);
      try {
        const result = await uploadImageToHost(file);
        onUploaded(result.publicUrl, result.dataUri);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [onUploaded],
  );

  const preview = localPreview || url;
  const hasImage = Boolean(preview);

  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-lg border-2 border-dashed transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          isUploading && "opacity-60",
          !hasImage && "cursor-pointer",
        )}
        onClick={() => !hasImage && !isUploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        {hasImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={label}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-3 text-center">
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Click or drop image
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  JPG, PNG, WebP — 10MB
                </p>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function StartEndFrameUploader() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const [startLocalPreview, setStartLocalPreview] = useState("");
  const [endLocalPreview, setEndLocalPreview] = useState("");

  const startUrl = watch("start_image_url");
  const endUrl = watch("end_image_url");

  return (
    <div className="grid grid-cols-2 gap-3">
      <FrameSlot
        label="Start Frame"
        required
        url={startUrl}
        localPreview={startLocalPreview}
        onUploaded={(publicUrl, dataUri) => {
          setValue("start_image_url", publicUrl, { shouldValidate: true });
          setStartLocalPreview(dataUri);
        }}
        onClear={() => {
          setValue("start_image_url", "", { shouldValidate: true });
          setStartLocalPreview("");
        }}
      />
      <FrameSlot
        label="End Frame (optional)"
        url={endUrl}
        localPreview={endLocalPreview}
        onUploaded={(publicUrl, dataUri) => {
          setValue("end_image_url", publicUrl, { shouldValidate: true });
          setEndLocalPreview(dataUri);
        }}
        onClear={() => {
          setValue("end_image_url", "", { shouldValidate: true });
          setEndLocalPreview("");
        }}
      />
    </div>
  );
}
