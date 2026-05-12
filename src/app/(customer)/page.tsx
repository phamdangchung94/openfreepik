"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { GeneratorForm, type GeneratorFormHandle } from "@/components/generator/generator-form";
import { ImprovePromptDialog } from "@/components/generator/improve-prompt-dialog";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { HistorySidebar } from "@/components/history/history-sidebar";
import { useGenerateVideo, type GeneratePayload } from "@/hooks/use-generate-video";
import { useBatchQueue } from "@/hooks/use-batch-queue";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useOrphanRecovery } from "@/hooks/use-orphan-recovery";
import { useAutoDownload } from "@/hooks/use-auto-download";
import { useHistoryHydration } from "@/hooks/use-history-hydration";
import { useTaskStore } from "@/store/task-store";
import { useAuthStore } from "@/store/auth-store";
import { useRegenerateHandler } from "@/store/regenerate-handler-store";
import { CustomerOnboarding } from "@/components/customer-onboarding";
import { BatchProgressWidget } from "@/components/batch/batch-progress-widget";
import { toApiParams } from "@/lib/form/to-api-params";
import { checkRecentRepeatFailures } from "@/lib/repeat-failure-check";
import type { GenerationTask } from "@/store/task-store";

import type { GeneratorFormValues, BatchItem } from "@/lib/form/generator-schema";

export default function HomePage() {
  const { generate, activeCount } = useGenerateVideo();
  const { startBatch, cancelBatch, retryFailed, isProcessing, progress } = useBatchQueue();
  useOrphanRecovery(); // Resume polling for tasks orphaned by page reload
  useAutoDownload(); // Browser-download videos when their tasks complete
  useHistoryHydration(); // Pull completed videos from server on activation (cross-device)
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const activationCode = useAuthStore((s) => s.activationCode);
  const formRef = useRef<GeneratorFormHandle>(null);

  // Show onboarding card in the preview slot for first-visit users
  // (no activation code OR no history yet). Hides automatically.
  const showOnboarding = !activationCode || Object.keys(tasks).length === 0;

  const handleSingleSubmit = useCallback(
    async (payload: GeneratePayload) => {
      const { activationCode } = useAuthStore.getState();
      if (!activationCode) {
        toast.error("Bạn cần kích hoạt mã trước");
        return;
      }
      // Derive {mode, imageUrl} per model — each has a different image
      // field shape (Kling V3/WAN use start_image_url, Kling 4K I2V
      // uses `image`, Kling 4K T2V has neither).
      let mode: "t2v" | "i2v";
      let imageUrl: string | undefined;
      if (payload.model === "kling-4k") {
        mode = payload.variant;
        imageUrl = payload.variant === "i2v" ? payload.params.image : undefined;
      } else if (payload.model === "wan-v27") {
        mode = "i2v"; // WAN is image-only
        imageUrl = payload.params.start_image_url;
      } else {
        // kling-v3
        imageUrl = payload.params.start_image_url;
        mode = imageUrl ? "i2v" : "t2v";
      }
      // JSON-as-prompt detector: production logs caught a customer
      // pasting a JSON params blob (`{"aspect_ratio":"9:16",...}`) into
      // the prompt field — every task failed because the upstream
      // renderer treats the prompt as a text description, not a config
      // object. Surface a one-shot warning. The customer can still
      // proceed if they actually want JSON-like text in the video.
      const promptText = (payload.params.prompt ?? "").trim();
      const looksLikeJson =
        (promptText.startsWith("{") && promptText.endsWith("}")) ||
        (promptText.startsWith("[") && promptText.endsWith("]"));
      if (looksLikeJson && promptText.length > 10) {
        toast.warning(
          "Prompt là mô tả bằng văn bản, không phải JSON cấu hình. Hãy mô tả nội dung video bạn muốn (ví dụ: 'một con mèo chạy trên bãi biển'). Chọn 16:9 / 9:16, chất lượng… ở các ô bên dưới.",
          { duration: 10000 },
        );
      }

      // Repeat-failure check: if this exact prompt/image just failed
      // 3+ times in the last 10 min, the upstream renderer is almost
      // certainly rejecting the input deterministically (content
      // policy, bad image, etc.). Surface a non-blocking toast so the
      // customer knows to tweak the input instead of burning more
      // refunded tasks. We DON'T block — false positives are possible
      // and the user keeps agency.
      const { shouldWarn, failedCount } = checkRecentRepeatFailures({
        prompt: payload.params.prompt ?? "",
        mode,
        imageUrl,
        tasks: useTaskStore.getState().tasks,
      });
      if (shouldWarn) {
        toast.warning(
          `Prompt/ảnh này đã thất bại ${failedCount} lần gần đây — hãy thử đổi mô tả hoặc ảnh khác. Tiền của các lần thất bại đã được hoàn vào mã.`,
          { duration: 8000 },
        );
      }
      try {
        const localId = await generate(payload, {
          prompt: payload.params.prompt ?? "",
          mode,
          imageUrl,
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

  // Register the regenerate handler with the global store so the
  // header-mounted ErrorLogButton can trigger it. Cleanup on unmount
  // prevents stale closures pointing at a defunct formRef.
  const setRegenerateHandler = useRegenerateHandler((s) => s.setHandler);
  useEffect(() => {
    setRegenerateHandler(handleRegenerate);
    return () => setRegenerateHandler(null);
  }, [handleRegenerate, setRegenerateHandler]);

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

      {/* Sticky bottom-right batch progress widget. Replaces the per-task
          toast spam — one piece of UI tracks all in-flight work. Hides
          itself when there's nothing in flight. */}
      <BatchProgressWidget
        total={progress.total}
        completed={progress.completed}
        failed={progress.failed}
        running={progress.running}
        queued={progress.queued}
        isProcessing={isProcessing}
        onCancel={cancelBatch}
        onRetryFailed={() => {
          const n = retryFailed();
          if (n === 0) toast.error("Không còn task lỗi để thử lại");
          else toast.success(`Đang thử lại ${n} video`);
          return n;
        }}
      />
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
