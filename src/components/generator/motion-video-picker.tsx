"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Upload, X, Loader2, Video as VideoIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadVideoToHost } from "@/lib/upload/image-host";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — Magnific docs cap ref video here
const MIN_DURATION_S = 3;
const MAX_DURATION_S = 30;
const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
];

/**
 * Reference video uploader for Kling Motion Control. Customer drops in
 * a 3-30s MP4/MOV/WEBM/M4V; we validate client-side then upload to
 * litterbox.catbox.moe (free, 24h TTL, 1GB cap). Preview uses
 * URL.createObjectURL — no data URI to avoid 50MB base64 bloat in the
 * React tree.
 *
 * Magnific's docs say the reference video can be up to ~10s for normal
 * motions and 30s in `character_orientation="video"` mode; we let
 * customers upload up to 30s and surface the duration cap mismatch via
 * the output_duration validation in the form schema.
 */
export function MotionVideoPicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const url = watch("motion_video_url");

  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string>("");
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // Revoke the blob URL on unmount or when a new file replaces it —
  // browsers don't GC these without explicit cleanup, and 50MB blobs
  // sticking around across the session would balloon tab memory.
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
        // Some browsers need explicit preload="metadata" to fire
        // loadedmetadata for video files served via blob URLs.
        video.preload = "metadata";
        video.src = blobUrl;
        const cleanup = () => URL.revokeObjectURL(blobUrl);
        const timer = setTimeout(() => {
          cleanup();
          // Metadata didn't arrive (corrupt file or unsupported codec).
          // Don't block upload — Magnific will reject if needed; just
          // skip the client-side duration check.
          resolve({ ok: true });
        }, 5_000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          cleanup();
          const seconds = video.duration;
          if (!Number.isFinite(seconds)) {
            resolve({ ok: true }); // unknown duration, allow upload
            return;
          }
          if (seconds < MIN_DURATION_S) {
            resolve({
              ok: false,
              seconds,
              reason: `Video quá ngắn (${seconds.toFixed(1)}s) — cần tối thiểu ${MIN_DURATION_S}s.`,
            });
            return;
          }
          if (seconds > MAX_DURATION_S) {
            resolve({
              ok: false,
              seconds,
              reason: `Video quá dài (${seconds.toFixed(1)}s) — cần tối đa ${MAX_DURATION_S}s.`,
            });
            return;
          }
          resolve({ ok: true, seconds });
        };
        video.onerror = () => {
          clearTimeout(timer);
          cleanup();
          resolve({ ok: true }); // can't read metadata, allow upload
        };
      });
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("video/") || !ACCEPTED_TYPES.includes(file.type)) {
        setError("Chỉ hỗ trợ MP4, MOV, WEBM, M4V");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`Tối đa 50MB (file: ${(file.size / 1_048_576).toFixed(1)}MB)`);
        return;
      }

      const dur = await validateDuration(file);
      if (!dur.ok) {
        setError(dur.reason ?? "Video không hợp lệ");
        return;
      }
      setDurationSeconds(dur.seconds ?? null);

      // Local preview swap happens before upload completes so the
      // customer sees their video right away — feels instant even if
      // the litterbox POST takes 5-10s.
      const preview = URL.createObjectURL(file);
      setLocalPreview(preview);

      // Store detected duration on the form so the auto-output-duration
      // logic in the parent form can pick the right pricing tier
      // without needing to know about this picker's internals.
      const seconds = dur.seconds ?? 0;
      if (seconds > 0) {
        setValue("motion_video_duration", seconds, { shouldDirty: true });
      }

      setIsUploading(true);
      try {
        const result = await uploadVideoToHost(file);
        setValue("motion_video_url", result.publicUrl, { shouldDirty: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload thất bại");
        // Roll back local preview — keeping it when upload failed
        // would mislead the customer that the video is ready.
        URL.revokeObjectURL(preview);
        setLocalPreview("");
        setDurationSeconds(null);
        setValue("motion_video_duration", 0, { shouldDirty: true });
      } finally {
        setIsUploading(false);
      }
    },
    [setValue, validateDuration],
  );

  const clear = useCallback(() => {
    if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
    setLocalPreview("");
    setDurationSeconds(null);
    setError(null);
    setValue("motion_video_url", "", { shouldDirty: true });
    setValue("motion_video_duration", 0, { shouldDirty: true });
    if (inputRef.current) inputRef.current.value = "";
  }, [localPreview, setValue]);

  const previewSrc = localPreview || (url && /^https?:/.test(url) ? url : "");
  const hasVideo = Boolean(previewSrc);

  return (
    <div className="space-y-2">
      <Label>
        Video tham chiếu motion <span className="text-destructive">*</span>
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          (3-30s, MP4/MOV/WEBM, ≤50MB)
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
                <VideoIcon className="size-7" />
                <span className="text-xs">Kéo thả video vào đây</span>
                <span className="text-[10px] opacity-70">hoặc bấm để chọn file</span>
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
      {hasVideo && !isUploading && !url && (
        <p className="text-[11px] text-amber-600">
          <Upload className="mr-1 inline-block size-3" />
          Đang upload tới host công cộng — chờ vài giây trước khi submit.
        </p>
      )}
    </div>
  );
}
