"use client";

import { toast } from "sonner";
import { useTaskStore, type GenerationTask } from "@/store/task-store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Video, AlertCircle, Loader2, Download, RotateCcw, Clock } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { VideoPlayer } from "./video-player";
import { UrlCountdown } from "./url-countdown";
import { friendlyError } from "@/lib/error-messages";
import { buildFilename, downloadVideo } from "@/lib/auto-download";
import { ParametersBlock } from "./parameters-block";
import { RecentTaskStrip } from "./recent-task-strip";
import { cn } from "@/lib/utils";

interface PreviewPanelProps {
  onRegenerate?: (task: GenerationTask) => void;
}

/**
 * Map the task's aspect-ratio param to the matching Tailwind class so
 * preview placeholders (empty/loading/error) sit on the same footprint
 * the eventual video will occupy — no jarring resize when the task
 * transitions COMPLETED.
 */
function aspectClass(ratio?: string) {
  if (ratio === "9:16") return "aspect-[9/16] max-h-[70vh]";
  if (ratio === "1:1") return "aspect-square";
  return "aspect-video";
}

function EmptyState() {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-muted/50 px-6 text-center max-md:-mx-4 max-md:w-auto max-md:rounded-none">
      <Video className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm text-foreground/70">Chưa chọn video</p>
      <p className="text-xs text-muted-foreground">
        Chọn 1 video từ lịch sử hoặc tạo mới từ form bên trái.
      </p>
    </div>
  );
}

function LoadingState({
  task,
  position,
  totalActive,
}: {
  task: GenerationTask;
  position: number;
  totalActive: number;
}) {
  // QUEUED = waiting for an upstream slot. Soft message + slower
  // pulse so customers don't think their request is broken.
  const isQueued = task.status === "QUEUED";
  const headline = isQueued
    ? "Đang xếp hàng — chờ slot trống"
    : `Đang tạo video${totalActive > 1 ? ` — ${position}/${totalActive}` : "…"}`;

  return (
    <div className="space-y-4">
      {/* `max-md:-mx-4` pulls the placeholder edge-to-edge with the
          Card on mobile (Card has px-4 on CardContent), making it feel
          like a real "hero" video frame. `max-md:rounded-none` strips
          the corner radius since the parent Card already provides the
          outer rounding. */}
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xl bg-muted max-md:-mx-4 max-md:w-auto max-md:rounded-none",
          aspectClass(task.params?.aspectRatio),
        )}
      >
        <Skeleton className="h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Loader2
            className={`h-8 w-8 animate-spin ${isQueued ? "text-amber-500" : "text-primary"}`}
          />
          <p className="text-sm font-medium text-foreground/80">{headline}</p>
          {isQueued && (
            <p className="text-[11px] text-muted-foreground">
              Pool đang đầy — sẽ tự động chạy khi có slot.
            </p>
          )}
          <p className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
            &ldquo;{task.prompt}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorState({
  task,
  onRegenerate,
}: {
  task: GenerationTask;
  onRegenerate?: () => void;
}) {
  const cancelled = task.status === "CANCELLED";
  const heading = cancelled
    ? "Đã huỷ"
    : task.status === "TIMEOUT"
      ? "Tạo video quá thời gian"
      : "Tạo video thất bại";
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-xl max-md:-mx-4 max-md:w-auto max-md:rounded-none",
          aspectClass(task.params?.aspectRatio),
          cancelled ? "bg-muted/40" : "bg-destructive/5",
        )}
      >
        <AlertCircle
          className={`h-10 w-10 ${cancelled ? "text-muted-foreground" : "text-destructive"}`}
        />
        <p
          className={`text-sm font-medium ${
            cancelled ? "text-muted-foreground" : "text-destructive"
          }`}
        >
          {heading}
        </p>
      </div>
      {task.error && !cancelled && (
        <>
          <p className="text-sm text-destructive/80">{friendlyError(task.error)}</p>
          {/* Recovery hint — most upstream failures are one of these
              four causes. Shown on every FAILED task so the customer
              has a concrete next step instead of just clicking Tạo lại
              with the same input. */}
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2.5 text-[11px] text-muted-foreground">
            <p className="mb-1 font-medium text-foreground/80">
              💡 Nếu cùng prompt/ảnh vẫn thất bại nhiều lần, thử:
            </p>
            <ul className="ml-3 list-disc space-y-0.5">
              <li>Diễn đạt prompt khác hoặc dùng từ ngắn gọn hơn</li>
              <li>Đổi ảnh nguồn (nếu đang dùng Image-to-Video)</li>
              <li>Đổi chất lượng (720p / 1080p / 4K) hoặc thời lượng ngắn hơn</li>
              <li>Tắt audio nếu đang bật</li>
            </ul>
          </div>
        </>
      )}
      <p className="text-sm text-muted-foreground">
        {task.prompt}
      </p>
      {onRegenerate && (
        <Button variant="outline" size="sm" className="w-full" onClick={onRegenerate}>
          <RotateCcw className="size-3.5 mr-1.5" />
          Tạo lại
        </Button>
      )}
    </div>
  );
}

function CompletedState({
  task,
  onRegenerate,
}: {
  task: GenerationTask;
  onRegenerate?: () => void;
}) {
  const markDownloaded = useTaskStore((s) => s.markDownloaded);

  async function handleDownload() {
    if (!task.videoUrl || !task.taskId) return;
    if (task.videoUrlExpiresAt && task.videoUrlExpiresAt < Date.now()) {
      toast.error("Link đã hết hạn — không thể tải");
      return;
    }
    const filename = buildFilename({
      tier: task.tier,
      prompt: task.prompt,
      createdAt: task.createdAt,
    });
    const loading = toast.loading(`Đang tải ${filename}...`);
    const result = await downloadVideo({
      freepikTaskId: task.taskId,
      videoUrl: task.videoUrl,
      filename,
    });
    toast.dismiss(loading);
    if (result.ok) {
      markDownloaded(task.id);
      toast.success(`Đã tải ${filename}`);
    } else {
      const msg =
        result.error === "expired"
          ? "Link đã hết hạn — không thể tải"
          : result.error === "auth"
            ? "Mã kích hoạt hết hạn — vui lòng đăng nhập lại"
            : result.error === "network"
              ? "Lỗi mạng — kiểm tra kết nối và thử lại"
              : "Tải thất bại — thử lại sau";
      toast.error(msg);
    }
  }

  // COMPLETED + no videoUrl = link expired (R2 deleted at 24h; the
  // expired-url cleaner hook nulls the URL out of local state). Show
  // an explanatory panel instead of a broken <video> tag.
  const urlExpired = !task.videoUrl;

  return (
    <div className="space-y-4">
      {/* Edge-to-edge video on mobile (max-md:-mx-4) — phone preview
          deserves max real estate; the parent Card's overflow-hidden
          + rounded-3xl clips cleanly. Desktop unchanged. */}
      <div className="max-md:-mx-4">
        {urlExpired ? (
          <ExpiredVideoPanel
            aspectRatio={task.params?.aspectRatio}
            expiredAt={task.videoUrlExpiresAt}
          />
        ) : (
          <VideoPlayer
            src={task.videoUrl ?? ""}
            poster={task.thumbnailUrl ?? undefined}
            aspectRatio={task.params?.aspectRatio}
            className="max-md:rounded-none"
          />
        )}
      </div>
      <div className="space-y-3">
        {/* Prompt + meta-row condensed: badges instead of long Vietnamese
            phrases — saves vertical space while staying readable. */}
        <p className="text-sm leading-snug text-foreground/90">
          {task.prompt}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {task.params?.model === "kling-motion" ? (
            <>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                Motion {motionTierLabel(task.params.motionTier)}
              </span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                {task.params.orientation === "image" ? "Theo ảnh" : "Theo video"}
              </span>
              {task.params.duration && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                  {task.params.duration}s
                </span>
              )}
            </>
          ) : task.params?.model === "kling-omni" ? (
            <>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                Omni {omniTierLabel(task.params.omniTier)}
              </span>
              {task.params.duration && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                  {task.params.duration}s
                </span>
              )}
              {task.params.audio && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                  Audio
                </span>
              )}
              {task.params.omniElements && task.params.omniElements.length > 0 && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                  {task.params.omniElements.length} element{task.params.omniElements.length > 1 ? "s" : ""}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                {task.mode === "t2v" ? "T2V" : "I2V"}
              </span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/80">
                {task.tier === "4k" ? "4K" : task.tier === "pro" ? "1080p" : "720p"}
              </span>
            </>
          )}
          <span className="ml-auto">
            <UrlCountdown expiresAt={task.videoUrlExpiresAt} />
          </span>
        </div>

        {/* Action bar: Tải về + Regenerate side-by-side instead of two
            full-width stacked buttons. Frees ~36px vertical space. */}
        {(task.videoUrl || onRegenerate) && (
          <div className="grid grid-cols-2 gap-2">
            {task.videoUrl && (
              <Button
                variant="default"
                size="sm"
                onClick={handleDownload}
              >
                <Download className="size-3.5 mr-1.5" />
                {task.downloadedAt ? "Tải lại" : "Tải về"}
              </Button>
            )}
            {onRegenerate && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRegenerate}
                // When download isn't available (no URL yet), span both
                // columns so the regenerate button doesn't look orphaned.
                className={!task.videoUrl ? "col-span-2" : undefined}
              >
                <RotateCcw className="size-3.5 mr-1.5" />
                Tạo lại
              </Button>
            )}
          </div>
        )}

        <ParametersBlock task={task} />
      </div>
    </div>
  );
}

export function PreviewPanel({ onRegenerate }: PreviewPanelProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);

  const task = activeTaskId ? tasks[activeTaskId] : null;

  // Position context for LoadingState — "Generating video — 2 of 5"
  // gives the customer reassurance their batch is moving.
  const activeIds = Object.values(tasks)
    .filter((t) => t.status === "IN_PROGRESS" || t.status === "CREATED" || t.status === "QUEUED")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => t.id);
  const position = task ? activeIds.indexOf(task.id) + 1 : 0;

  const handleRegenerate = task && onRegenerate ? () => onRegenerate(task) : undefined;

  return (
    // Sticky only on desktop — on mobile this Card is the only thing
    // in the Xem tab so sticky just adds a useless 16px gap at top.
    <Card className="md:sticky md:top-4">
      <CardHeader className="max-md:pb-2">
        <CardTitle className="flex items-center justify-between gap-2 max-md:text-base">
          <span>Xem trước</span>
          {task && <StatusBadge status={task.status} />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Mobile-only: horizontal thumbnail strip lets the customer
            switch between recent tasks without leaving Xem tab.
            Hidden on md+ (History sidebar handles it). */}
        <RecentTaskStrip />
        {!task && <EmptyState />}
        {task?.status === "COMPLETED" && (
          <CompletedState task={task} onRegenerate={handleRegenerate} />
        )}
        {task &&
          (task.status === "FAILED" ||
            task.status === "TIMEOUT" ||
            task.status === "CANCELLED") && (
            <ErrorState task={task} onRegenerate={handleRegenerate} />
          )}
        {task &&
          (task.status === "CREATED" || task.status === "IN_PROGRESS" || task.status === "QUEUED") && (
            <LoadingState
              task={task}
              position={position}
              totalActive={activeIds.length}
            />
          )}
      </CardContent>
    </Card>
  );
}

/**
 * Placeholder rendered in place of the VideoPlayer when a COMPLETED
 * task's R2 URL has been cleared by the expired-url cleaner. Matches
 * the video's aspect ratio + edge-to-edge mobile look so the layout
 * doesn't shift when transitioning into expired state.
 *
 * Why the explicit panel (vs hiding the player): customers were seeing
 * broken `<video>` icons + browser-default error UI; the audit caller
 * couldn't tell at a glance whether the system was broken or the URL
 * just naturally expired. This makes the expiry obvious + actionable
 * ("Tạo lại" is still wired up below).
 */
function ExpiredVideoPanel({
  aspectRatio,
  expiredAt,
}: {
  aspectRatio?: string;
  expiredAt: number | null;
}) {
  const hoursAgo =
    expiredAt && expiredAt < Date.now()
      ? Math.floor((Date.now() - expiredAt) / 3_600_000)
      : null;
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 px-6 text-center max-md:-mx-4 max-md:w-auto max-md:rounded-none",
        aspectClass(aspectRatio),
      )}
    >
      <Clock className="size-10 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground/80">
        Video đã hết hạn
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Link tự xoá sau 24h để tiết kiệm dung lượng. Nhấn{" "}
        <span className="font-medium text-foreground/80">Tạo lại</span> nếu muốn
        có video mới với cùng prompt.
        {hoursAgo !== null && hoursAgo > 0 && (
          <span className="block text-[10px] opacity-70">
            (đã hết hạn {hoursAgo} giờ trước)
          </span>
        )}
      </p>
    </div>
  );
}


function motionTierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'v2-6-std':
      return '2.6 Std';
    case 'v2-6-pro':
      return '2.6 Pro';
    case 'v3-std':
      return '3.0 Std';
    case 'v3-pro':
      return '3.0 Pro';
    default:
      return '';
  }
}

function omniTierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'omni-std':
      return 'Std';
    case 'omni-pro':
      return 'Pro';
    case 'omni-ref-std':
      return 'Std (V2V)';
    case 'omni-ref-pro':
      return 'Pro (V2V)';
    default:
      return '';
  }
}
