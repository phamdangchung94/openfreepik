/**
 * Server-component / route-handler helpers for the admin session.
 * Lives in a separate file from admin.ts because next/headers can only be
 * imported from server-side modules — keeping it isolated avoids pulling
 * the cookies API into the Edge middleware bundle.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, validateAdminSession } from "./admin";

/**
 * Read the admin session cookie and validate it against the DB.
 * Returns true if the current request is authenticated as admin.
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value ?? null;
  return validateAdminSession(token);
}

/**
 * Use at the top of every protected dashboard server page — redirects to
 * the login page if the session cookie is missing or stale.
 */
export async function requireAdmin(nextPath?: string): Promise<void> {
  const ok = await isAdminAuthenticated();
  if (!ok) {
    const dest = nextPath
      ? `/dashboard/login?next=${encodeURIComponent(nextPath)}`
      : "/dashboard/login";
    redirect(dest);
  }
}

/**
 * Use at the top of every /api/admin/* route handler. Returns null if the
 * caller is authenticated; returns a 401 NextResponse otherwise so the
 * handler can early-return: `if (denied) return denied`.
 */
export async function requireAdminApi(): Promise<NextResponse | null> {
  const ok = await isAdminAuthenticated();
  if (ok) return null;
  return NextResponse.json(
    { ok: false, error: "AUTH", message: "Admin authentication required." },
    { status: 401 },
  );
}
