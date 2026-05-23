import { NextResponse, type NextRequest } from "next/server";

/**
 * Canonical-host redirect middleware.
 *
 * The Vercel project has multiple aliases (freepik.io.vn,
 * openfreepik.vercel.app, *-chugaxs-projects.vercel.app, etc.) but
 * customer-facing UX must funnel through video.chugax.io.vn so:
 *   - Docs page Base URL matches the address bar
 *   - Browser bookmarks land on the canonical name
 *   - Customers don't see stale brand names ("freepik.io.vn") in
 *     the URL bar while reading our docs
 *
 * What we DON'T redirect:
 *   - /api/*: existing customer/AI integrations may still use legacy
 *     aliases as their base URL. Force-redirecting POST to a new host
 *     can drop request bodies on naïve HTTP clients, breaks Magnific
 *     webhook delivery to keys registered at the old URL, and would
 *     surprise any AI-tool customer mid-call. Both hosts answer the
 *     same routes; let them.
 *   - localhost / 127.0.0.1: local dev MUST stay on localhost.
 *   - *.vercel.app preview deploys: each PR/branch gets a unique URL
 *     that we want to be reachable for QA before merge.
 *
 * 308 = permanent redirect that preserves the HTTP method (a 301
 * would coerce POST → GET on some clients). Browsers cache the
 * redirect, so once a user visits the canonical host once their
 * browser routes them directly on subsequent loads.
 */

const CANONICAL_HOST = "video.chugax.io.vn";

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // Allow canonical + dev + Vercel preview/system URLs through unchanged.
  if (
    host === CANONICAL_HOST ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.endsWith(".vercel.app")
  ) {
    return NextResponse.next();
  }

  // API routes never redirect — backward compat for customer integrations
  // + Magnific webhook deliveries keyed on alias URLs.
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const targetUrl = `https://${CANONICAL_HOST}${pathname}${search}`;
  return NextResponse.redirect(targetUrl, 308);
}

export const config = {
  // Skip Next internals (build assets) — they're already cached by
  // domain, no need to rewrite. Static images bucket included so logo
  // / favicon don't trigger a redirect roundtrip.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
