"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { FrameSlot } from "./start-end-frame-uploader";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

/**
 * Single-image picker for Kling Motion's character image input.
 * Wraps the existing FrameSlot component (exported from
 * start-end-frame-uploader) so we get the same upload pipeline + drag-
 * drop UX as the I2V flow, just without the end-frame slot.
 *
 * Field: `start_image_url` (reused — Motion treats the start image as
 * the character image; no conflict because Motion doesn't use I2V at
 * the same time).
 */
export function MotionCharacterImagePicker() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const [localPreview, setLocalPreview] = useState("");
  const url = watch("start_image_url");

  return (
    <FrameSlot
      label="Ảnh nhân vật"
      required
      url={url}
      localPreview={localPreview}
      // 16:9 to match the reference-video picker sitting next to it
      // in the form (default FrameSlot is aspect-square for the
      // start/end-frame I2V flow).
      aspectClass="aspect-video"
      onUploaded={(publicUrl, dataUri) => {
        setValue("start_image_url", publicUrl, { shouldValidate: true });
        setLocalPreview(dataUri);
      }}
      onClear={() => {
        setValue("start_image_url", "");
        setLocalPreview("");
      }}
    />
  );
}
