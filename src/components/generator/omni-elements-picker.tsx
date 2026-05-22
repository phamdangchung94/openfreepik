"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import { Plus, Trash2, Upload, X, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadImageToHost } from "@/lib/upload/image-host";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

const MAX_ELEMENTS = 6;
const MAX_REFERENCE_IMAGES_PER_ELEMENT = 3;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per Magnific docs

/**
 * Omni Elements — character/object identity lock. Customer uploads
 * 1-6 elements, each with a frontal image (required) + optional 3
 * extra reference angles. References as `@Element1` … `@Element6`
 * in the prompt. Magnific keeps identity consistent across frames.
 *
 * Per-element card layout:
 *   ┌─────────────────────────────────────────┐
 *   │ @Element1                          [X]  │
 *   │ ┌──────┐ ┌─┐ ┌─┐ ┌─┐                   │
 *   │ │frntl │ │R│ │R│ │R│  (frontal big,    │
 *   │ │      │ │1│ │2│ │3│   refs small)     │
 *   │ └──────┘ └─┘ └─┘ └─┘                   │
 *   └─────────────────────────────────────────┘
 *
 * Tap empty slot to upload; tap filled slot to clear.
 *
 * Same R2 upload pipeline as character image — URLs live ≤120 min
 * via `sweep-uploads` cron, regenerate flow can reuse if within
 * window.
 */
export function OmniElementsPicker() {
  const { control } = useFormContext<GeneratorFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "omni_elements",
  });

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/10 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <User className="size-3.5" />
              Elements (giữ nhân vật / vật thể nhất quán)
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Upload ảnh nhân vật → tham chiếu trong prompt là{" "}
              <Code>@Element1</Code>, <Code>@Element2</Code>...{" "}
              Tối đa 6 elements.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              append({ frontal_image_url: "", reference_image_urls: [] })
            }
          >
            <Plus className="size-3" />
            Thêm element
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <User className="size-3.5" />
          Elements ({fields.length}/{MAX_ELEMENTS})
        </Label>
        {fields.length < MAX_ELEMENTS && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              append({ frontal_image_url: "", reference_image_urls: [] })
            }
          >
            <Plus className="size-3" />
            Thêm
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Tham chiếu trong prompt bằng <Code>@Element1</Code> ...{" "}
        <Code>@Element{fields.length}</Code>. Mỗi element cần ít nhất 1 ảnh
        (frontal hoặc reference angles).
      </p>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <ElementCard
            key={f.id}
            index={i}
            onRemove={() => remove(i)}
          />
        ))}
      </div>
    </div>
  );
}

function ElementCard({
  index,
  onRemove,
}: {
  index: number;
  onRemove: () => void;
}) {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const frontal = watch(`omni_elements.${index}.frontal_image_url`);
  const refs = watch(`omni_elements.${index}.reference_image_urls`) ?? [];

  function setFrontal(url: string) {
    setValue(`omni_elements.${index}.frontal_image_url`, url, {
      shouldDirty: true,
    });
  }
  function setRefs(next: string[]) {
    setValue(`omni_elements.${index}.reference_image_urls`, next, {
      shouldDirty: true,
    });
  }
  function addRefUrl(url: string) {
    setRefs([...refs, url].slice(0, MAX_REFERENCE_IMAGES_PER_ELEMENT));
  }
  function removeRef(at: number) {
    setRefs(refs.filter((_, i) => i !== at));
  }

  return (
    <div className="rounded-md border bg-background p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          @Element{index + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onRemove}
          className="h-6 text-destructive hover:text-destructive"
          title="Xoá element"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <div className="space-y-1">
          <ImageSlot
            label="Frontal"
            url={frontal}
            onChange={setFrontal}
            big
          />
          <p className="text-center text-[9px] text-muted-foreground">
            Chính diện
          </p>
        </div>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {refs.map((url, i) => (
            <ImageSlot
              key={i}
              label={`Ref ${i + 1}`}
              url={url}
              onChange={(next) => {
                if (next) {
                  // Replace existing URL at index i
                  const newRefs = [...refs];
                  newRefs[i] = next;
                  setRefs(newRefs);
                } else {
                  removeRef(i);
                }
              }}
            />
          ))}
          {refs.length < MAX_REFERENCE_IMAGES_PER_ELEMENT && (
            <ImageSlot
              label={`+ Ref ${refs.length + 1}`}
              url=""
              onChange={(next) => next && addRefUrl(next)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ImageSlot({
  label,
  url,
  onChange,
  big = false,
}: {
  label: string;
  url: string;
  onChange: (url: string) => void;
  big?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error("Chỉ JPG/PNG/WebP");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("Tối đa 10MB");
        return;
      }
      setIsUploading(true);
      try {
        const result = await uploadImageToHost(file);
        onChange(result.publicUrl);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload thất bại");
      } finally {
        setIsUploading(false);
      }
    },
    [onChange],
  );

  const hasImage = Boolean(url);
  const sizeCls = big ? "size-20" : "size-14";

  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-md border-2 border-dashed transition-colors",
          sizeCls,
          hasImage
            ? "border-primary/40"
            : "cursor-pointer border-muted-foreground/30 hover:border-muted-foreground/60",
          isUploading && "opacity-60",
        )}
        onClick={() => !hasImage && !isUploading && inputRef.current?.click()}
        title={label}
      >
        {hasImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={label}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="absolute right-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-80 hover:opacity-100"
              aria-label="Xoá"
            >
              <X className="size-2.5" />
            </button>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
            {isUploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            <span className="text-[8px]">{label}</span>
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
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
      {children}
    </code>
  );
}
