"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Upload, X, Loader2, Video as VideoIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadVideoToHost } from "@/lib/upload/image-host";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MAX_FILE_SIZE = 200 * 1024 * 1024; // Omni spec allows up to 200MB
const MIN_DURATION_S = 3;
const MAX_DURATION_S = 10; // Omni V2V Magnific docs cap
const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
];

/**
 * Reference-video uploader for Kling Omni V2V mode. Similar to motion-
 * video-picker but with different constraints (Magnific Omni V2V docs:
 * 3-10s ref, 720-2160px, max 200MB, MP4/MOV).
 */
export function OmniVideoPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const url = watch("omni_video_url");

  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string>("");
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const validateDuration = useCallback(
    (file: File): Promise<{ ok: boolean; seconds?: number; reason?: string }> => {
      return new Promise((resolve) => {
        const blobUrl = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = blobUrl;
        const cleanup = () => URL.revokeObjectURL(blobUrl);
        const timer = setTimeout(() => {
          cleanup();
          resolve({ ok: true });
        }, 5_000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          cleanup();
          const seconds = video.duration;
          if (!Number.isFinite(seconds)) {
            resolve({ ok: true });
            return;
          }
          if (seconds < MIN_DURATION_S) {
            resolve({
              ok: false,
              seconds,
              reason: `Video phải ≥${MIN_DURATION_S} giây.`,
            });
            return;
          }
          if (seconds > MAX_DURATION_S) {
            resolve({
              ok: false,
              seconds,
              reason: `Video phải ≤${MAX_DURATION_S} giây cho Omni V2V.`,
            });
            return;
          }
          resolve({ ok: true, seconds });
        };
        video.onerror = () => {
          clearTimeout(timer);
          cleanup();
          resolve({ ok: true });
        };
      });
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Chỉ hỗ trợ MP4, MOV, WEBM, M4V.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`Kích thước tối đa 200MB.`);
        return;
      }
      const dur = await validateDuration(file);
      if (!dur.ok) {
        setError(dur.reason ?? "Video không hợp lệ.");
        return;
      }

      const preview = URL.createObjectURL(file);
      if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
      setLocalPreview(preview);
      setDurationSeconds(dur.seconds ?? null);

      const seconds = dur.seconds ?? 0;
      if (seconds > 0) {
        setValue("omni_video_duration", seconds, { shouldDirty: true });
      }

      setIsUploading(true);
      try {
        const result = await uploadVideoToHost(file);
        setValue("omni_video_url", result.publicUrl, { shouldDirty: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload thất bại");
        URL.revokeObjectURL(preview);
        setLocalPreview("");
        setDurationSeconds(null);
        setValue("omni_video_duration", 0, { shouldDirty: true });
      } finally {
        setIsUploading(false);
      }
    },
    [setValue, validateDuration, localPreview],
  );

  const clear = useCallback(() => {
    if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
    setLocalPreview("");
    setDurationSeconds(null);
    setError(null);
    setValue("omni_video_url", "", { shouldDirty: true });
    setValue("omni_video_duration", 0, { shouldDirty: true });
    if (inputRef.current) inputRef.current.value = "";
  }, [localPreview, setValue]);

  const previewSrc = localPreview || (url && /^https?:/.test(url) ? url : "");
  const hasVideo = Boolean(previewSrc);

  return (
    <div className="space-y-2">
      <Label>
        Video tham chiếu (V2V) <span className="text-destructive">*</span>
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          (3-10s, MP4/MOV/WEBM, ≤200MB)
        </span>
      </Label>
      <div
        className={cn(
          "relative aspect-video w-full overflow-hidden rounded-lg border-2 border-dashed transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          isUploading && "opacity-60",
          !hasVideo && "cursor-pointer",
        )}
        onClick={() => !hasVideo && !isUploading && inputRef.current?.click()}
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
        {hasVideo ? (
          <>
            <video
              src={previewSrc}
              className="h-full w-full object-cover"
              controls
              muted
              playsInline
              preload="metadata"
            />
            <button
              type="button"
              aria-label="Xoá video"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-80 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
            {durationSeconds !== null && (
              <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {durationSeconds.toFixed(1)}s
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            {isUploading ? (
              <>
                <Loader2 className="size-6 animate-spin" />
                <span className="text-xs">Đang tải video…</span>
              </>
            ) : (
              <>
                <Upload className="size-6" />
                <span className="text-sm">Kéo thả video vào đây</span>
                <span className="text-xs">hoặc bấm để chọn file</span>
                <VideoIcon className="size-4 opacity-40" />
              </>
            )}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
