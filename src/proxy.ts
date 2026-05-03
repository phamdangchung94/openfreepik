import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth/admin";

/**
 * Edge proxy — runs on dashboard routes only.
 *
 * What used to live here: an `/api/*` Origin allowlist intended to block
 * browser-based cross-origin abuse (audit S5). In practice, that gate was
 * causing legitimate 403s for customers visiting via Vercel preview
 * aliases or Vercel CDN edge variants whose Host header didn't match the
 * Origin the browser sent. Browsers already enforce same-origin policy
 * on the response side (CORS), so a server-side Origin allowlist adds
 * friction without preventing real abuse — a malicious site can always
 * server-side-proxy the call and never send an Origin header at all.
 *
 * Defense remaining: rate limit + activation-code bearer auth (both at
 * the route level), plus the strict CSP in next.config.ts that prevents
 * scripts from other origins from loading inside our pages.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip the login page itself.
  if (pathname === "/dashboard/login") {
    return NextResponse.next();
  }

  // Only gate /dashboard/*. Everything else (including /api/*) is open.
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
  matcher: ["/dashboard/:path*"],
};
