import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth/admin";

/**
 * Edge proxy — two responsibilities, ordered intentionally:
 *
 *   1. **Canonical-host redirect**: funnel all customer-facing browser
 *      traffic to https://video.chugax.io.vn so docs URLs + bookmarks
 *      always show the canonical brand. Aliases (freepik.io.vn,
 *      openfreepik.vercel.app, etc.) get 308'd. /api/* exempted for
 *      backwards-compat (existing customer integrations + Magnific
 *      webhook delivery keyed on the old aliases).
 *
 *   2. **Dashboard auth gate**: any /dashboard/* hit without the admin
 *      session cookie redirects to /dashboard/login.
 *
 * Historical note: this file used to host an /api/* Origin allowlist
 * (audit S5) which was removed because browsers already enforce
 * same-origin via CORS — server-side Origin gates just caused 403s for
 * customers on Vercel preview aliases without preventing real abuse.
 *
 * Filename: Next.js 16 renamed `middleware.ts` → `proxy.ts`; same edge
 * runtime semantics, no behavioral diff vs the old name.
 */

const CANONICAL_HOST = "video.chugax.io.vn";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // ── 1. Canonical-host redirect ───────────────────────────────────
  // Skip when:
  //   - already canonical
  //   - localhost / 127.0.0.1 (dev)
  //   - *.vercel.app (preview deploys must stay reachable for QA)
  //   - /api/* (legacy callers + Magnific webhook continue working)
  const isCanonical = host === CANONICAL_HOST;
  const isDev = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const isPreview = host.endsWith(".vercel.app");
  const isApi = pathname.startsWith("/api/");

  if (!isCanonical && !isDev && !isPreview && !isApi) {
    const targetUrl = `https://${CANONICAL_HOST}${pathname}${search}`;
    // 308 preserves the HTTP method through the redirect (301 would
    // coerce POST → GET on some clients). Browser caches the redirect.
    return NextResponse.redirect(targetUrl, 308);
  }

  // ── 2. Dashboard auth gate ───────────────────────────────────────
  if (pathname === "/dashboard/login") {
    return NextResponse.next();
  }
  if (!pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Cover everything except Next build assets + common static files.
  // Required so canonical-host check fires on EVERY navigation, not
  // just /dashboard/*. /api/* still flows through but early-exits
  // inside the function body (isApi check).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
