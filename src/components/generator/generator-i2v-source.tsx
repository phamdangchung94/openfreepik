"use client";

import { ImagePlus } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { Separator } from "@/components/ui/separator";
import { BatchUploadZone } from "@/components/batch/batch-upload-zone";
import { BatchSettings } from "@/components/batch/batch-settings";
import { ImageUrlField } from "./image-url-field";
import { StartEndFrameUploader } from "./start-end-frame-uploader";
import type {
  BatchItem,
  GeneratorFormValues,
} from "@/lib/form/generator-schema";

interface GeneratorI2VSourceProps {
  batchItems: BatchItem[];
  onAddBatchItems: (items: BatchItem[]) => void;
  onRemoveBatchItem: (id: string) => void;
  onUpdateBatchPrompt: (id: string, prompt: string) => void;
}

export function GeneratorI2VSource({
  batchItems,
  onAddBatchItems,
  onRemoveBatchItem,
  onUpdateBatchPrompt,
}: GeneratorI2VSourceProps) {
  const { watch } = useFormContext<GeneratorFormValues>();

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Source Images</span>
        </div>

        <BatchUploadZone
          items={batchItems}
          onAddItems={onAddBatchItems}
          onRemoveItem={onRemoveBatchItem}
          onUpdatePrompt={onUpdateBatchPrompt}
          defaultPrompt={watch("prompt") ?? ""}
        />

        {batchItems.length > 0 && (
          <div className="flex items-center justify-between">
            <BatchSettings />
          </div>
        )}

        {batchItems.length === 0 && (
          <div className="space-y-3">
            <StartEndFrameUploader />
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Or enter image URLs directly
              </summary>
              <div className="mt-3 space-y-3">
                <ImageUrlField
                  name="start_image_url"
                  label="Start Frame URL"
                  required
                  placeholder="https://example.com/start.jpg"
                />
                <ImageUrlField
                  name="end_image_url"
                  label="End Frame URL (optional)"
                  placeholder="https://example.com/end.jpg"
                />
              </div>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
