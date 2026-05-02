import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth/admin";

/**
 * Edge proxy — fast cookie-presence check only. The actual DB-backed
 * session validation runs in each protected page (server component) and API
 * route. This split keeps the proxy off the DB but still prevents
 * unauthenticated visitors from seeing dashboard markup at all.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip the login page itself + the login API endpoint.
  if (
    pathname === "/dashboard/login" ||
    pathname === "/api/admin/login" ||
    !pathname.startsWith("/dashboard")
  ) {
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
