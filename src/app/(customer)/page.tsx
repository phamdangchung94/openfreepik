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
import { useAutoDownload } from "@/hooks/use-auto-download";
import { useTaskStore } from "@/store/task-store";
import { useAuthStore } from "@/store/auth-store";
import { CustomerOnboarding } from "@/components/customer-onboarding";
import { toApiParams } from "@/lib/form/to-api-params";
import type { GenerationTask } from "@/store/task-store";

import type { GeneratorFormValues, BatchItem } from "@/lib/form/generator-schema";

export default function HomePage() {
  const { generate, activeCount } = useGenerateVideo();
  const { startBatch, cancelBatch, isProcessing } = useBatchQueue();
  useOrphanRecovery(); // Resume polling for tasks orphaned by page reload
  useAutoDownload(); // Browser-download videos when their tasks complete
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const activationCode = useAuthStore((s) => s.activationCode);
  const formRef = useRef<GeneratorFormHandle>(null);

  // Show onboarding card in the preview slot for first-visit users
  // (no activation code OR no history yet). Hides automatically.
  const showOnboarding = !activationCode || Object.keys(tasks).length === 0;

  const handleSingleSubmit = useCallback(
    async (params: ReturnType<typeof toApiParams>, tier: "pro" | "std") => {
      const { activationCode } = useAuthStore.getState();
      if (!activationCode) {
        toast.error("Bạn cần kích hoạt mã trước");
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
        toast.success("Đã bắt đầu tạo video");
      } catch {
        toast.error("Không thể bắt đầu tạo video");
      }
    },
    [generate, setActiveTaskId],
  );

  const handleBatchSubmit = useCallback(
    (items: BatchItem[], sharedParams: GeneratorFormValues) => {
      const { activationCode } = useAuthStore.getState();
      if (!activationCode) {
        toast.error("Bạn cần kích hoạt mã trước");
        return;
      }
      startBatch(items, sharedParams);
      toast.success(`Đã bắt đầu batch: ${items.length} video`);
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
      toast.info("Đã tải lại — chỉnh prompt và tạo lại");
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
      {/*
       * 3-column at lg+ (form + preview/onboarding + history)
       * 2-column at md  (form + history; preview/onboarding hidden — user sees it after submit)
       * 1-column at sm  (form only; sidebar lives in a sheet from header)
       */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_420px_260px]">
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

        {/* Center: Preview panel — replaced by Onboarding for first-visit users.
            Hidden under lg so tablets prioritise form + history. */}
        <div className="hidden lg:order-2 lg:block">
          {showOnboarding ? (
            <CustomerOnboarding />
          ) : (
            <PreviewPanel onRegenerate={handleRegenerate} />
          )}
        </div>

        {/* Right: History Sidebar — visible from tablet up. */}
        <div className="hidden md:order-3 md:block">
          <div className="sticky top-4 h-[calc(100vh-6rem)] rounded-3xl border bg-card">
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
