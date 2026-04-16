"use client";

import { cn } from "@/lib/utils";
import { Video } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

export function VideoPlayer({ src, poster, className }: VideoPlayerProps) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex aspect-video w-full items-center justify-center rounded-lg bg-muted",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Video className="h-10 w-10" />
          <p className="text-sm">No video available</p>
        </div>
      </div>
    );
  }

  return (
    <video
      src={src}
      poster={poster ?? undefined}
      controls
      autoPlay
      loop
      playsInline
      className={cn("aspect-video w-full rounded-lg bg-black", className)}
    />
  );
}
