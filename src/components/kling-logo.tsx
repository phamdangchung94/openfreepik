import { cn } from "@/lib/utils";

interface KlingLogoProps {
  className?: string;
  /** Pixel size — applied to width AND height. Default 24. */
  size?: number;
}

/**
 * Stylized "K" mark used as the product logo. Polar Blue → Cosmic Violet
 * gradient (design-system tokens) with a Neon Green status dot signalling
 * the live AI video service. Pure SVG so it scales crisply at any size.
 */
export function KlingLogo({ className, size = 24 }: KlingLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Kling Video"
    >
      <defs>
        <linearGradient id="kling-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8dd6ff" />
          <stop offset="1" stopColor="#8c93fb" />
        </linearGradient>
      </defs>
      <path
        d="M5 4 V20 M5 12 L19 4 M5 12 L19 20"
        stroke="url(#kling-grad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="4" r="1.6" fill="#5fed83" />
    </svg>
  );
}
