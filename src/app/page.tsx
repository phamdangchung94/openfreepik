"use client";

import { useCallback, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { GeneratorForm, type GeneratorFormHandle } from "@/components/generator/generator-form";
import { ImprovePromptDialog } from "@/components/generator/improve-prompt-dialog";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { HistorySidebar } from "@/components/history/history-sidebar";
import { useGenerateVideo } from "@/hooks/use-generate-video";
import { useBatchQueue } from "@/hooks/use-batch-queue";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useOrphanRecovery } from "@/hooks/use-orphan-recovery";
import { useTaskStore } from "@/store/task-store";
import { toApiParams } from "@/lib/form/to-api-params";
import type { GenerationTask } from "@/store/task-store";

import type { GeneratorFormValues, BatchItem } from "@/lib/form/generator-schema";

export default function HomePage() {
  const { generate, activeCount } = useGenerateVideo();
  const { startBatch, cancelBatch, isProcessing } = useBatchQueue();
  useOrphanRecovery(); // Resume polling for tasks orphaned by page reload
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const formRef = useRef<GeneratorFormHandle>(null);

  const handleSingleSubmit = useCallback(
    async (params: ReturnType<typeof toApiParams>, tier: "pro" | "std") => {
      const { apiKey } = useTaskStore.getState();
      if (!apiKey) {
        toast.error("Please enter your Freepik API key first");
        return;
      }
      try {
        const localId = await generate(params, {
          tier,
          prompt: params.prompt ?? "",
          mode: params.start_image_url ? "i2v" : "t2v",
          imageUrl: params.start_image_url,
        });
        setActiveTaskId(localId);
        toast.success("Generation started");
      } catch {
        toast.error("Failed to start generation");
      }
    },
    [generate, setActiveTaskId],
  );

  const handleBatchSubmit = useCallback(
    (items: BatchItem[], sharedParams: GeneratorFormValues) => {
      const { apiKey } = useTaskStore.getState();
      if (!apiKey) {
        toast.error("Please enter your Freepik API key first");
        return;
      }
      startBatch(items, sharedParams);
      toast.success(`Batch started: ${items.length} videos`);
    },
    [startBatch],
  );

  const handleRegenerate = useCallback(
    (task: GenerationTask) => {
      formRef.current?.loadTask({
        prompt: task.prompt,
        mode: task.mode,
        imageUrl: task.imageUrl,
      });
      toast.info("Task loaded — edit prompt and generate again");
    },
    [],
  );

  useKeyboardShortcuts({
    onGenerate: () => {
      formRef.current?.submit();
    },
    enabled: true,
  });

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px_260px]">
        {/* Left: Generator Form */}
        <div className="min-w-0">
          <GeneratorForm
            ref={formRef}
            onSubmitSingle={handleSingleSubmit}
            onSubmitBatch={handleBatchSubmit}
            activeCount={activeCount}
            improveButton={<ImprovePromptWrapper />}
          />
        </div>

        {/* Center: Preview Panel */}
        <div className="hidden lg:block">
          <PreviewPanel onRegenerate={handleRegenerate} />
        </div>

        {/* Right: History Sidebar */}
        <div className="hidden lg:block">
          <div className="sticky top-4 h-[calc(100vh-6rem)] rounded-lg border bg-card">
            <HistorySidebar />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Connects ImprovePromptDialog to react-hook-form context.
 * Rendered inside <FormProvider> via PromptField's improveButton slot.
 */
function ImprovePromptWrapper() {
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const currentPrompt = watch("prompt") ?? "";

  return (
    <ImprovePromptDialog
      currentPrompt={currentPrompt}
      onAccept={(improved) => setValue("prompt", improved)}
    />
  );
}
