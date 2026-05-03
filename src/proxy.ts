import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth/admin";

/**
 * Origin allowlist for `/api/*`. Same-origin requests don't carry an
 * `Origin` header (or carry one that matches the host), so a check that
 * rejects mismatched Origin headers blocks browser-based cross-origin
 * attacks without breaking server-side or curl callers.
 *
 * Set ALLOWED_ORIGINS in Vercel env to override (comma-separated). The
 * defaults cover production + the Vercel preview URL pattern.
 */
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "https://openfreepik.vercel.app,https://freepik.io.vn,http://localhost:3000,http://localhost:3001"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Edge proxy — runs on every request. Two concerns:
 *
 *   1. /dashboard/*   → require admin session cookie (presence only).
 *      DB-backed validation still runs in the page server component.
 *   2. /api/*          → reject browser cross-origin POSTs by checking
 *      the Origin header against the allowlist. GETs without an Origin
 *      header (curl, server-side, same-origin) pass through.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const blocked = isCrossOriginBlocked(request);
    if (blocked) {
      return NextResponse.json(
        { error: "FORBIDDEN_ORIGIN", message: "Origin not allowed." },
        { status: 403 },
      );
    }
    // Cron route is public-by-key; everything else falls through.
    return NextResponse.next();
  }

  if (!pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  // Skip the login page itself + the login API endpoint.
  if (pathname === "/dashboard/login") {
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

function isCrossOriginBlocked(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // server-side / curl / same-origin GET — allowed

  // The browser always sends Origin on cross-origin XHR/fetch and on
  // same-origin POSTs. If it matches the request's own host, allow.
  // Otherwise consult the allowlist.
  const host = request.headers.get("host");
  if (host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return false;
    } catch {
      // malformed Origin — treat as blocked
      return true;
    }
  }

  return !ALLOWED_ORIGINS.includes(origin);
}

export const config = {
  // Match dashboard pages AND every API route — the proxy decides what
  // to do for each.
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
