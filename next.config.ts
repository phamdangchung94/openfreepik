import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Allow-listed origins for img-src / media-src / connect-src.
 * Keep this list narrow — every entry expands the XSS blast radius.
 */
const FREEPIK_ORIGIN = "https://*.freepik.com";
const UPLOAD_ORIGIN = "https://litterbox.catbox.moe";

/**
 * Static CSP. `'unsafe-inline'` and `'unsafe-eval'` are concessions to
 * Next.js + Tailwind hot-reload; tightening to a nonce-based CSP via
 * proxy.ts is tracked as a follow-up to this commit.
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${FREEPIK_ORIGIN} ${UPLOAD_ORIGIN}`,
  `media-src 'self' ${FREEPIK_ORIGIN}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${FREEPIK_ORIGIN} ${UPLOAD_ORIGIN}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
