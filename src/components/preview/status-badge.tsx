"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GenerationTaskStatus } from "@/store/task-store";

interface StatusBadgeProps {
  status: GenerationTaskStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  GenerationTaskStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; extra?: string }
> = {
  IDLE: { label: "Chờ", variant: "secondary" },
  CREATED: { label: "Đã tạo", variant: "outline" },
  IN_PROGRESS: { label: "Đang xử lý", variant: "default", extra: "animate-pulse" },
  COMPLETED: { label: "Hoàn tất", variant: "default", extra: "bg-primary text-primary-foreground" },
  FAILED: { label: "Thất bại", variant: "destructive" },
  TIMEOUT: { label: "Quá thời gian", variant: "destructive" },
  CANCELLED: { label: "Đã huỷ", variant: "secondary" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, variant, extra } = STATUS_CONFIG[status];

  return (
    <Badge variant={variant} className={cn(extra, className)}>
      {label}
    </Badge>
  );
}
