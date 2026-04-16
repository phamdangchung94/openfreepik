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
  IDLE: { label: "Idle", variant: "secondary" },
  CREATED: { label: "Created", variant: "outline" },
  IN_PROGRESS: { label: "In Progress", variant: "default", extra: "animate-pulse" },
  COMPLETED: { label: "Completed", variant: "default", extra: "bg-emerald-600 text-white" },
  FAILED: { label: "Failed", variant: "destructive" },
  TIMEOUT: { label: "Timeout", variant: "destructive" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, variant, extra } = STATUS_CONFIG[status];

  return (
    <Badge variant={variant} className={cn(extra, className)}>
      {label}
    </Badge>
  );
}
