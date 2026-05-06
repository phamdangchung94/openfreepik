"use client";

import { cn } from "@/lib/utils";
import { safeMediaUrl } from "@/lib/url-allowlist";
import { Video } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

export function VideoPlayer({ src, poster, className }: VideoPlayerProps) {
  const safeSrc = safeMediaUrl(src);
  const safePoster = safeMediaUrl(poster);

  if (!safeSrc) {
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

  // Modern browsers block autoplay for unmuted video. We start muted so
  // playback always works, then the user clicks the volume control to
  // hear audio (matches YouTube / Twitter / TikTok preview UX).
  return (
    <video
      src={safeSrc}
      poster={safePoster ?? undefined}
      controls
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      className={cn("aspect-video w-full rounded-lg bg-black", className)}
    />
  );
}
