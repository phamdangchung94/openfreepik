"use client";

/**
 * Detect a mobile-like device. Used to disable auto-download on iOS Safari
 * and Android — those browsers either ignore the `download` attribute,
 * navigate to the file in a new tab, or queue downloads silently.
 *
 * Heuristic combines:
 *   - `pointer: coarse` — touch-primary devices (best signal)
 *   - UA fallback for older browsers without matchMedia
 *
 * Returns false during SSR (`typeof window` check) so the desktop UI
 * renders first; the layout swap on hydration is acceptable for a
 * preference toggle.
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;

  // matchMedia is the most reliable signal — Apple touch trackpads still
  // report `pointer: fine`, so this correctly excludes laptops.
  if (window.matchMedia?.("(pointer: coarse)").matches) return true;

  const ua = window.navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
}
