"use client";

import { useState, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { customZodResolver } from "@/lib/form/zod-resolver";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generatorFormSchema,
  type GeneratorFormValues,
  type BatchItem,
} from "@/lib/form/generator-schema";
import { FORM_DEFAULTS } from "@/lib/form/defaults";
import { toApiParams } from "@/lib/form/to-api-params";
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
import { CostPreview } from "./cost-preview";

interface GeneratorFormProps {
  onSubmitSingle?: (params: ReturnType<typeof toApiParams>, tier: "pro" | "std") => void;
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

  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [t2vBatchText, setT2vBatchText] = useState("");
  const [t2vBatchOpen, setT2vBatchOpen] = useState(false);

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
    } else if (onSubmitSingle) {
      const params = toApiParams(values);
      onSubmitSingle(params, values.tier);
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
            <ModeToggle
              onModeChange={() => {
                // Switching mode invalidates the queued batch — different shape.
                setBatchItems([]);
                setT2vBatchText("");
                setT2vBatchOpen(false);
              }}
            />
            {mode === "t2v" && (
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
            {mode === "i2v" && (
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
            <div className="grid gap-4 sm:grid-cols-2">
              <AspectRatioPicker />
              <QualityTierPicker />
            </div>
            <DurationSlider />
            <GenerateAudioSwitch />
          </CardContent>
        </Card>

        <GeneratorAdvancedSettings />
        <GeneratorMultiShotSection />

        {/* Real-time cost preview — updates as tier/duration/audio change. */}
        <CostPreview count={isBatchMode ? batchItems.length : 1} />

        {/* Submit — never disabled, user can fire multiple generations */}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={t2vBatchOpen && batchItems.length === 0}
        >
          {isBatchMode ? (
            `Tạo ${batchItems.length} Video`
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
