"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { Wand2, Eye, History } from "lucide-react";
import { cn } from "@/lib/utils";

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
import { MobileNowPlayingBar } from "@/components/preview/mobile-now-playing-bar";
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

  // Mobile-only tab state. Desktop renders all 3 sections side-by-side
  // (md+ unchanged); mobile shows one at a time + a bottom tab bar.
  // After Generate, auto-switch to "preview" so the customer sees the
  // task progress instead of staring at the form they just submitted.
  type MobileTab = "form" | "preview" | "history";
  const [mobileTab, setMobileTab] = useState<MobileTab>("form");

  // Badge counts for the bottom tab bar.
  const tabCounts = useMemo(() => {
    let running = 0;
    let failed = 0;
    for (const t of Object.values(tasks)) {
      if (t.status === "IN_PROGRESS" || t.status === "CREATED" || t.status === "QUEUED") {
        running++;
      } else if (
        (t.status === "FAILED" || t.status === "TIMEOUT") &&
        !t.errorAcknowledgedAt
      ) {
        failed++;
      }
    }
    return { running, failed };
  }, [tasks]);

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
        // Mobile UX: after a successful submit, switch to the Preview
        // tab so the customer actually sees their task progressing
        // instead of staring at the same form. No-op on desktop where
        // all 3 sections are visible simultaneously.
        setMobileTab("preview");
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
      // Same mobile auto-switch as single submit — point customer at
      // the running tasks instead of leaving them on the form.
      setMobileTab("preview");
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
      // Mobile: regenerate populates the form, so jump back to the
      // Form tab so the customer can see/edit before re-submitting.
      setMobileTab("form");
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
    <div className="mx-auto max-w-[1600px] px-4 py-6 pb-24 md:pb-6">
      {/*
       * Desktop (md+): 3-column at lg+, 2-column at md — unchanged.
       * Mobile (<md): one section at a time controlled by mobileTab,
       *   with a fixed bottom tab bar for switching. Auto-switches to
       *   "preview" after Generate so the customer sees their result.
       */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_420px_260px]">
        {/* Left: Generator Form.
            Mobile (<md): visible only when tab === "form".
            Desktop (md+): always visible, layout unchanged. */}
        <div
          className={cn(
            "min-w-0 md:block",
            mobileTab === "form" ? "block" : "hidden",
          )}
        >
          <GeneratorForm
            ref={formRef}
            onSubmitSingle={handleSingleSubmit}
            onSubmitBatch={handleBatchSubmit}
            activeCount={activeCount}
            improveButton={<ImprovePromptWrapper />}
          />
        </div>

        {/* Center: Preview panel — replaced by Onboarding for first-visit users.
            Mobile (<md): visible only when tab === "preview".
            md→lg: hidden (tablets prioritise form + history, unchanged).
            lg+: always visible in column 2, unchanged. */}
        <div
          className={cn(
            "md:hidden lg:order-2 lg:block",
            mobileTab === "preview" ? "block" : "hidden",
          )}
        >
          {showOnboarding ? (
            <CustomerOnboarding />
          ) : (
            <PreviewPanel onRegenerate={handleRegenerate} />
          )}
        </div>

        {/* Right: History Sidebar.
            Mobile (<md): visible only when tab === "history".
            Desktop (md+): always visible, sticky sidebar unchanged. */}
        <div
          className={cn(
            "md:order-3 md:block",
            mobileTab === "history" ? "block" : "hidden",
          )}
        >
          <div className="rounded-3xl border bg-card md:sticky md:top-4 md:h-[calc(100vh-6rem)]">
            <HistorySidebar />
          </div>
        </div>
      </div>

      {/* Mobile "now playing" bar — floats above the bottom tab nav,
          shows current/recent task at a glance, tap to open Xem. Hides
          when no relevant task or when already on Xem tab. */}
      <MobileNowPlayingBar
        hidden={mobileTab === "preview"}
        onOpen={() => setMobileTab("preview")}
      />

      {/* Mobile bottom tab nav — hidden on md+. Fixed bottom; respects
          iOS safe-area-inset. Badges show running task count (preview
          tab) and unread-error count (history tab). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-[1600px] grid-cols-3">
          <MobileTabButton
            active={mobileTab === "form"}
            onClick={() => setMobileTab("form")}
            icon={<Wand2 className="size-5" />}
            label="Tạo"
          />
          <MobileTabButton
            active={mobileTab === "preview"}
            onClick={() => setMobileTab("preview")}
            icon={<Eye className="size-5" />}
            label="Xem"
            badge={tabCounts.running > 0 ? tabCounts.running : undefined}
          />
          <MobileTabButton
            active={mobileTab === "history"}
            onClick={() => setMobileTab("history")}
            icon={<History className="size-5" />}
            label="Lịch sử"
            badge={tabCounts.failed > 0 ? tabCounts.failed : undefined}
            badgeVariant="destructive"
          />
        </div>
      </nav>

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

/**
 * Single tab button for the mobile bottom nav. Active state uses
 * primary color + a thin top accent bar so the user always knows
 * which view they're on. Badge slot (top-right of the icon) is for
 * running-task / unread-error counts.
 */
function MobileTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  badgeVariant = "default",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeVariant?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-[11px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      {active && (
        <span className="absolute inset-x-4 top-0 h-0.5 rounded-b bg-primary" />
      )}
      <span className="relative">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span
            className={cn(
              "absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white",
              badgeVariant === "destructive" ? "bg-destructive" : "bg-primary",
            )}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}
