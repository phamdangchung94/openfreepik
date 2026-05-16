"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { safeMediaUrl } from "@/lib/url-allowlist";
import { PictureInPicture2, Video } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  /**
   * Aspect ratio of the source video — "16:9" | "9:16" | "1:1". The
   * player picks a matching CSS aspect so the video fills the frame
   * instead of getting letterboxed in a forced 16:9 container. Falls
   * back to 16:9 when omitted (older tasks without params.aspectRatio).
   */
  aspectRatio?: string;
}

function aspectClass(ratio?: string) {
  if (ratio === "9:16") return "aspect-[9/16]";
  if (ratio === "1:1") return "aspect-square";
  return "aspect-video"; // default 16:9
}

export function VideoPlayer({
  src,
  poster,
  className,
  aspectRatio,
}: VideoPlayerProps) {
  const safeSrc = safeMediaUrl(src);
  const safePoster = safeMediaUrl(poster);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [inPip, setInPip] = useState(false);

  // Probe PiP support after mount (avoids SSR mismatch on document.*).
  useEffect(() => {
    if (typeof document === "undefined") return;
    setPipSupported(
      "pictureInPictureEnabled" in document &&
        document.pictureInPictureEnabled === true,
    );
  }, []);

  // Track PiP state so the button label flips between enter/exit.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onEnter = () => setInPip(true);
    const onLeave = () => setInPip(false);
    el.addEventListener("enterpictureinpicture", onEnter);
    el.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      el.removeEventListener("enterpictureinpicture", onEnter);
      el.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [safeSrc]);

  async function togglePip() {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement === el) {
        await document.exitPictureInPicture();
      } else {
        await el.requestPictureInPicture();
      }
    } catch {
      // Silent — Safari/iOS may reject for permissions or unsupported
      // codec; the button just appears to do nothing rather than throw.
    }
  }

  if (!safeSrc) {
    return (
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-lg bg-muted",
          aspectClass(aspectRatio),
          className,
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
    <div className={cn("relative w-full", className)}>
      <video
        ref={videoRef}
        src={safeSrc}
        poster={safePoster ?? undefined}
        controls
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className={cn(
          "w-full rounded-lg bg-black",
          aspectClass(aspectRatio),
          // Portrait videos can be very tall; cap at viewport so the
          // controls stay reachable on phones.
          aspectRatio === "9:16" && "max-h-[70vh] object-contain",
        )}
      />
      {pipSupported && (
        <button
          type="button"
          onClick={togglePip}
          aria-label={inPip ? "Thoát Picture-in-Picture" : "Mở Picture-in-Picture"}
          title={inPip ? "Thoát Picture-in-Picture" : "Picture-in-Picture"}
          // Top-right corner, above the native controls (which sit at
          // bottom). Semi-transparent so it doesn't fight the video.
          className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md bg-black/60 text-white opacity-80 transition-opacity hover:opacity-100"
        >
          <PictureInPicture2 className="size-4" />
        </button>
      )}
    </div>
  );
}
