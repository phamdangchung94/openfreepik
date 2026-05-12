"use client";

import { useState, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { customZodResolver } from "@/lib/form/zod-resolver";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generatorFormSchema,
  type GeneratorFormValues,
  type BatchItem,
} from "@/lib/form/generator-schema";
import { FORM_DEFAULTS } from "@/lib/form/defaults";
import {
  toApiParams,
  toKling4kT2vParams,
  toKling4kI2vParams,
  toWanParams,
} from "@/lib/form/to-api-params";
import { ModeToggle } from "./mode-toggle";
import { PromptField } from "./prompt-field";
import { AspectRatioPicker } from "./aspect-ratio-picker";
import { DurationSlider } from "./duration-slider";
import { QualityTierPicker } from "./quality-tier-picker";
import { GenerateAudioSwitch } from "./generate-audio-switch";
import { GeneratorI2VSource } from "./generator-i2v-source";
import { GeneratorAdvancedSettings } from "./generator-advanced-settings";
import { GeneratorMultiShotSection } from "./generator-multi-shot-section";
import { BatchT2VInput } from "@/components/batch/batch-t2v-input";
import { BatchSettings } from "@/components/batch/batch-settings";
import { CostPreview } from "./cost-preview";
import { ModelPicker } from "./model-picker";
import { ResolutionPicker } from "./resolution-picker";
import type { GeneratePayload } from "@/hooks/use-generate-video";

interface GeneratorFormProps {
  /**
   * Single-prompt submit. Receives a discriminated payload so the
   * page-level handler can dispatch to the right endpoint without
   * re-introspecting form values.
   */
  onSubmitSingle?: (payload: GeneratePayload) => void;
  onSubmitBatch?: (
    items: BatchItem[],
    sharedParams: GeneratorFormValues
  ) => void;
  /** Number of currently active generations (shown as badge, never blocks submit) */
  activeCount?: number;
  improveButton?: React.ReactNode;
}

/** Imperative handle exposed via ref for external control (regenerate, submit). */
export interface GeneratorFormHandle {
  submit: () => void;
  loadTask: (task: {
    prompt: string;
    mode: "t2v" | "i2v";
    imageUrl?: string | null;
  }) => void;
}

export const GeneratorForm = forwardRef<GeneratorFormHandle, GeneratorFormProps>(function GeneratorForm({
  onSubmitSingle,
  onSubmitBatch,
  activeCount = 0,
  improveButton,
}, ref) {
  const formElRef = useRef<HTMLFormElement>(null);
  const methods = useForm<GeneratorFormValues>({
    resolver: customZodResolver(generatorFormSchema),
    defaultValues: FORM_DEFAULTS,
  });

  useImperativeHandle(ref, () => ({
    submit: () => formElRef.current?.requestSubmit(),
    loadTask: (task) => {
      methods.setValue("mode", task.mode);
      methods.setValue("prompt", task.prompt);
      if (task.mode === "i2v" && task.imageUrl) {
        methods.setValue("start_image_url", task.imageUrl);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  }));

  const { handleSubmit, watch } = methods;
  const mode = watch("mode");
  const model = watch("model");
  const tier = watch("tier");
  const isWan = model === "wan-v27";
  const isKling3 = model === "kling-v3";
  /**
   * Kling 4K runs on different Magnific endpoints (kling-4k-t2v /
   * kling-4k-i2v) that don't accept multi_shot or elements arrays.
   * Treat the '4k' tier as a Kling-3 model but hide the fields the
   * upstream rejects.
   */
  const is4kTier = isKling3 && tier === "4k";

  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [t2vBatchText, setT2vBatchText] = useState("");
  const [t2vBatchOpen, setT2vBatchOpen] = useState(false);
  // "Số bản sao" — when ≥2 in single-prompt mode, the form fans out
  // the same prompt into N batch items so the existing batch infra
  // (concurrency queueing, progress widget, retry-failed) handles them.
  const [singleQty, setSingleQty] = useState(1);

  const isBatchMode =
    (mode === "i2v" && batchItems.length > 0) ||
    (mode === "t2v" && t2vBatchOpen && batchItems.length > 0);

  const handleAddBatchItems = useCallback((newItems: BatchItem[]) => {
    setBatchItems((prev) => [...prev, ...newItems]);
  }, []);

  const handleRemoveBatchItem = useCallback((id: string) => {
    setBatchItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleUpdateBatchPrompt = useCallback((id: string, prompt: string) => {
    setBatchItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, prompt } : item))
    );
  }, []);

  const handleT2vBatchItems = useCallback((items: BatchItem[]) => {
    setBatchItems(items);
  }, []);

  const onFormSubmit = (values: GeneratorFormValues) => {
    if (isBatchMode && onSubmitBatch) {
      onSubmitBatch(batchItems, values);
    } else if (singleQty > 1 && onSubmitBatch) {
      // Multi-copy single-prompt path. Reuse the batch hook so we get
      // concurrency queueing, the progress widget, and retry-failed for
      // free. Each copy gets its own localId via the batch infra.
      const items: BatchItem[] = Array.from({ length: singleQty }, () => ({
        id: `single-x${singleQty}-${crypto.randomUUID()}`,
        mode: values.mode,
        prompt: values.prompt ?? "",
        ...(values.mode === "i2v" && values.start_image_url
          ? { imageUrl: values.start_image_url }
          : {}),
      }));
      onSubmitBatch(items, values);
    } else if (onSubmitSingle) {
      // Branch payload shape:
      //   WAN 2.7      → resolution-encoded WAN params
      //   Kling 3 + 4K → kling-4k-{t2v,i2v} endpoints (no multi-shot)
      //   Kling 3 + Pro/Std → kling-v3-{pro,std} endpoint
      if (values.model === "wan-v27") {
        onSubmitSingle({
          model: "wan-v27",
          params: toWanParams(values),
        });
      } else if (values.tier === "4k") {
        if (values.mode === "t2v") {
          onSubmitSingle({
            model: "kling-4k",
            variant: "t2v",
            params: toKling4kT2vParams(values),
          });
        } else {
          onSubmitSingle({
            model: "kling-4k",
            variant: "i2v",
            params: toKling4kI2vParams(values),
          });
        }
      } else {
        onSubmitSingle({
          model: "kling-v3",
          params: toApiParams(values),
          tier: values.tier,
        });
      }
    }
  };

  return (
    <FormProvider {...methods}>
      <form
        ref={formElRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (isBatchMode && onSubmitBatch) {
            // Batch mode: skip zod validation (start_image_url is in each batch item)
            onSubmitBatch(batchItems, methods.getValues());
          } else {
            handleSubmit(onFormSubmit)(e);
          }
        }}
        className="space-y-4"
      >
        <Card>
          <CardContent className="pt-4 space-y-4">
            <ModelPicker />
            {/* WAN 2.7 is image-to-video only — hide the t2v/i2v
                toggle and any t2v-specific UI when WAN is selected.
                The form schema already locks mode to "i2v" on switch. */}
            {!isWan && (
              <ModeToggle
                onModeChange={() => {
                  // Switching mode invalidates the queued batch — different shape.
                  setBatchItems([]);
                  setT2vBatchText("");
                  setT2vBatchOpen(false);
                }}
              />
            )}
            {!isWan && mode === "t2v" && (
              <>
                {!t2vBatchOpen && (
                  <PromptField improveButton={improveButton} />
                )}
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => {
                      setT2vBatchOpen((v) => !v);
                      setBatchItems([]);
                      setT2vBatchText("");
                    }}
                  >
                    {t2vBatchOpen ? "← Một prompt" : "Batch (nhiều prompt) →"}
                  </button>
                </div>
                {t2vBatchOpen && (
                  <BatchT2VInput
                    value={t2vBatchText}
                    onChange={setT2vBatchText}
                    onItemsChange={handleT2vBatchItems}
                  />
                )}
              </>
            )}
            {(mode === "i2v" || isWan) && (
              <>
                <PromptField improveButton={improveButton} />
                <GeneratorI2VSource
                  batchItems={batchItems}
                  onAddBatchItems={handleAddBatchItems}
                  onRemoveBatchItem={handleRemoveBatchItem}
                  onUpdateBatchPrompt={handleUpdateBatchPrompt}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Cài đặt video
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isWan ? (
              // WAN 2.7: only resolution + duration. No tier, no
              // aspect-ratio (output ratio matches start_image_url),
              // no audio toggle (audio is upload-based — Phase 3).
              <>
                <ResolutionPicker />
                <DurationSlider />
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "grid gap-4",
                    // I2V on the 4K tier has no aspect_ratio param
                    // upstream — output aspect comes from the image.
                    // Hide the picker so customers don't think it
                    // changes anything. Tier picker stays full-width.
                    is4kTier && mode === "i2v"
                      ? "grid-cols-1"
                      : "sm:grid-cols-2",
                  )}
                >
                  {!(is4kTier && mode === "i2v") && <AspectRatioPicker />}
                  <QualityTierPicker />
                </div>
                <DurationSlider />
                <GenerateAudioSwitch />
              </>
            )}
          </CardContent>
        </Card>

        {/* Advanced (cfg_scale, negative prompt) is supported on all
            Kling V3 tiers including 4K. Multi-shot + elements arrays
            are Pro/Std-only — Magnific's kling-4k endpoints reject
            those request shapes. */}
        {isKling3 && <GeneratorAdvancedSettings />}
        {isKling3 && !is4kTier && <GeneratorMultiShotSection />}

        {/* Real-time cost preview — updates as tier/duration/audio change.
            When the customer sets singleQty > 1, multiply by qty so the
            preview reflects total batch cost. */}
        <CostPreview
          count={
            isBatchMode ? batchItems.length : singleQty
          }
        />

        {/* Quantity input — only shown in single-prompt mode. Hidden in
            batch mode where the customer's Excel/textarea controls count.
            Free 1–100 number input so customers can request large fan-outs
            (e.g. 50 takes of one prompt for a montage). The submit button
            label updates to "Tạo N Video" so the cost preview stays
            honest. */}
        {!isBatchMode && (
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-2">
              <label
                htmlFor="single-qty"
                className="text-xs text-muted-foreground"
              >
                Số bản sao
              </label>
              <input
                id="single-qty"
                type="number"
                min={1}
                max={100}
                step={1}
                value={singleQty}
                onChange={(e) => {
                  // Clamp at write-time so the rest of the form sees a
                  // sane number (cost preview multiplies by qty, etc.).
                  // Empty input → fall back to 1; out-of-range → clamp.
                  const raw = e.target.value;
                  if (raw === "") {
                    setSingleQty(1);
                    return;
                  }
                  const n = Math.floor(Number(raw));
                  if (!Number.isFinite(n)) return;
                  setSingleQty(Math.min(100, Math.max(1, n)));
                }}
                className="h-8 w-20 rounded-md border bg-background px-2 text-center text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Số bản sao của prompt này (1–100)"
              />
            </div>
            {/* When fanning out > 1 copy, surface the same concurrency
                control the batch flow uses. Without this the customer
                couldn't tell the queue to run e.g. 3-at-a-time from the
                single-prompt path — they'd be stuck on whatever the
                store last had. */}
            {singleQty > 1 && (
              <div className="rounded-md border bg-muted/30 p-3">
                <BatchSettings />
              </div>
            )}
          </div>
        )}

        {/* Submit — never disabled, user can fire multiple generations */}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={t2vBatchOpen && batchItems.length === 0}
        >
          {isBatchMode ? (
            `Tạo ${batchItems.length} Video`
          ) : singleQty > 1 ? (
            `Tạo ${singleQty} Video`
          ) : (
            <>
              Tạo Video
              <kbd className="ml-2 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-mono">
                ⌘↵
              </kbd>
            </>
          )}
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {activeCount} đang chạy
            </Badge>
          )}
        </Button>
      </form>
    </FormProvider>
  );
});
