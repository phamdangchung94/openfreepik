"use client";

import { useState, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { customZodResolver } from "@/lib/form/zod-resolver";
import {
  ChevronDown,
  Sparkles,
  Settings2,
  Layers,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  generatorFormSchema,
  type GeneratorFormValues,
  type BatchItem,
} from "@/lib/form/generator-schema";
import { FORM_DEFAULTS } from "@/lib/form/defaults";
import { toApiParams, toBatchApiParams } from "@/lib/form/to-api-params";
import { ModeToggle } from "./mode-toggle";
import { PromptField } from "./prompt-field";
import { NegativePromptField } from "./negative-prompt-field";
import { ImageUrlField } from "./image-url-field";
import { AspectRatioPicker } from "./aspect-ratio-picker";
import { DurationSlider } from "./duration-slider";
import { QualityTierPicker } from "./quality-tier-picker";
import { CfgScaleSlider } from "./cfg-scale-slider";
import { GenerateAudioSwitch } from "./generate-audio-switch";
import { MultiShotEditor } from "./multi-shot-editor";
import { BatchUploadZone } from "@/components/batch/batch-upload-zone";
import { BatchSettings } from "@/components/batch/batch-settings";
import { StartEndFrameUploader } from "./start-end-frame-uploader";

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
      // Scroll to top so user sees the loaded prompt
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  }));

  const { handleSubmit, watch, setValue } = methods;
  const mode = watch("mode");
  const multiShot = watch("multi_shot");

  // Batch state (local to this component)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [multiShotOpen, setMultiShotOpen] = useState(false);

  const isBatchMode = mode === "i2v" && batchItems.length > 0;

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
        {/* Mode Toggle */}
        <Card>
          <CardContent className="pt-4 space-y-4">
            <ModeToggle />

            {/* Prompt Section */}
            <PromptField improveButton={improveButton} />

            {/* I2V: Image URL or Batch Upload */}
            {mode === "i2v" && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ImagePlus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Source Images</span>
                  </div>

                  {/* Batch upload zone */}
                  <BatchUploadZone
                    items={batchItems}
                    onAddItems={handleAddBatchItems}
                    onRemoveItem={handleRemoveBatchItem}
                    onUpdatePrompt={handleUpdateBatchPrompt}
                    defaultPrompt={watch("prompt") ?? ""}
                  />

                  {/* Batch concurrency settings */}
                  {batchItems.length > 0 && (
                    <div className="flex items-center justify-between">
                      <BatchSettings />
                    </div>
                  )}

                  {/* Single video Start/End frame uploader (when no batch items) */}
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
            )}
          </CardContent>
        </Card>

        {/* Video Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Video Settings
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

        {/* Advanced Settings (collapsible) */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card>
            <CollapsibleTrigger>
              <CardHeader className="cursor-pointer pb-3 hover:bg-muted/50 transition-colors">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Advanced Settings
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      advancedOpen && "rotate-180"
                    )}
                  />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <CfgScaleSlider />
                <Separator />
                <NegativePromptField />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Multi-shot (collapsible) */}
        <Collapsible open={multiShotOpen} onOpenChange={setMultiShotOpen}>
          <Card>
            <CollapsibleTrigger>
              <CardHeader className="cursor-pointer pb-3 hover:bg-muted/50 transition-colors">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Multi-Shot Mode
                    {multiShot && (
                      <Badge variant="secondary" className="text-xs">
                        Enabled
                      </Badge>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      multiShotOpen && "rotate-180"
                    )}
                  />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="multi_shot_toggle" className="cursor-pointer">
                    Enable multi-shot (up to 6 scenes, max 15s total)
                  </Label>
                  <Switch
                    id="multi_shot_toggle"
                    checked={multiShot}
                    onCheckedChange={(v) => setValue("multi_shot", v)}
                  />
                </div>
                {multiShot && (
                  <>
                    <Separator />
                    <MultiShotEditor />
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Submit — never disabled, user can fire multiple generations */}
        <Button type="submit" size="lg" className="w-full">
          {isBatchMode ? (
            `Generate ${batchItems.length} Videos`
          ) : (
            <>
              Generate Video
              <kbd className="ml-2 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-mono">
                ⌘↵
              </kbd>
            </>
          )}
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {activeCount} running
            </Badge>
          )}
        </Button>
      </form>
    </FormProvider>
  );
});

