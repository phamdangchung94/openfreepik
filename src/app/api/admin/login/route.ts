import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  verifyAdminPassword,
} from "@/lib/auth/admin";
import {
  checkLoginAllowed,
  clearFailedLogins,
  getClientIp,
  recordFailedLogin,
} from "@/lib/auth/login-throttle";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

const loginSchema = z.object({
  password: z.string().min(1).max(256),
});

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h, matches admin.ts TTL

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // Throttle BEFORE compare so even malformed payloads count toward the
  // failure budget — otherwise an attacker could probe with garbage to
  // count attempts without triggering the lock.
  const status = await checkLoginAllowed(ip);
  if (status.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT",
        message: `Too many failed attempts. Wait ${Math.ceil(status.retryAfterSeconds / 60)} minutes.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(status.retryAfterSeconds) },
      },
    );
  }

  const body = await parseJsonBody(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    await recordFailedLogin(ip);
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Password required." },
      { status: 400 },
    );
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    const after = await recordFailedLogin(ip);
    return NextResponse.json(
      {
        ok: false,
        error: "AUTH",
        message: after.locked
          ? `Too many failed attempts. Locked for ${Math.ceil(after.retryAfterSeconds / 60)} minutes.`
          : `Wrong password. ${after.attemptsRemaining} attempt${after.attemptsRemaining === 1 ? "" : "s"} remaining.`,
      },
      { status: after.locked ? 429 : 401 },
    );
  }

  // Successful login — wipe the failure counter for this IP.
  await clearFailedLogins(ip);

  const token = await createAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Audit P2-6: "strict" was breaking the cross-site link flow (admin
    // pastes the dashboard link to themselves on Slack → click sends
    // the request without the cookie). "lax" still blocks CSRF on
    // top-level POST and the per-route admin check guards the rest.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return response;
}
