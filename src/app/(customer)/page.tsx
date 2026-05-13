"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

  // Pending payload + failure count surfaced by the BLOCK-tier
  // repeat-failure dialog. Ref-based fingerprint allowlist persists
  // across renders without re-triggering the modal once the customer
  // has explicitly chosen "Tôi vẫn muốn thử" for a given input.
  const overriddenFingerprints = useRef<Set<string>>(new Set());
  const [blockedPayload, setBlockedPayload] =
    useState<{ payload: GeneratePayload; failedCount: number; fingerprint: string } | null>(null);

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
      // Repeat-failure check — two tiers (audit 2026-05-13):
      //   - 3+ identical failures → warn-tier toast (non-blocking)
      //   - 5+ identical failures → block-tier modal (must confirm
      //     before proceeding). Customer can still override but the
      //     dialog forces a conscious decision.
      // We DON'T hard-block — false positives possible, user keeps
      // ultimate agency. Override decisions are remembered for the
      // rest of the session per fingerprint so the dialog doesn't
      // re-fire on every retry.
      const failureCheck = checkRecentRepeatFailures({
        prompt: payload.params.prompt ?? "",
        mode,
        imageUrl,
        tasks: useTaskStore.getState().tasks,
      });
      if (
        failureCheck.severity === "block" &&
        !overriddenFingerprints.current.has(failureCheck.fingerprint)
      ) {
        // Block-tier: open modal and bail out. The modal's confirm
        // handler re-enters handleSingleSubmit after marking the
        // fingerprint as overridden.
        setBlockedPayload({
          payload,
          failedCount: failureCheck.failedCount,
          fingerprint: failureCheck.fingerprint,
        });
        return;
      }
      if (failureCheck.severity === "warn") {
        toast.warning(
          `Prompt/ảnh này đã thất bại ${failureCheck.failedCount} lần gần đây — hãy thử đổi mô tả hoặc ảnh khác. Tiền của các lần thất bại đã được hoàn vào mã.`,
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

      {/* Block-tier repeat-failure confirmation. Opens when the same
          prompt/image just failed 5+ times — forces a conscious choice
          before the customer burns another refunded task. */}
      <AlertDialog
        open={blockedPayload !== null}
        onOpenChange={(next) => {
          if (!next) setBlockedPayload(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Prompt/ảnh này đã thất bại {blockedPayload?.failedCount ?? 0} lần
            </AlertDialogTitle>
            <AlertDialogDescription>
              Trong 10 phút qua, hệ thống AI tạo video đã từ chối yêu cầu
              này nhiều lần với cùng một input. Nhiều khả năng cần đổi
              prompt hoặc ảnh.
              <br />
              <br />
              Gợi ý:
              <br />
              • Diễn đạt prompt theo cách khác hoặc dùng từ đơn giản hơn
              <br />
              • Đổi ảnh nguồn nếu đang dùng I2V
              <br />
              • Thử chất lượng thấp hơn (720p) hoặc thời lượng ngắn hơn
              <br />
              <br />
              Tiền của các lần thất bại đã được hoàn về mã của bạn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK, tôi sẽ đổi input</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!blockedPayload) return;
                overriddenFingerprints.current.add(blockedPayload.fingerprint);
                const pending = blockedPayload.payload;
                setBlockedPayload(null);
                // Re-enter the submit pipeline — the fingerprint is now
                // in the override set so the block branch passes.
                void handleSingleSubmit(pending);
              }}
            >
              Tôi vẫn muốn thử lại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
