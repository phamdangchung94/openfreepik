import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  verifyAdminPassword,
} from "@/lib/auth/admin";
import { parseJsonBody } from "@/lib/freepik/route-helpers";

const loginSchema = z.object({
  password: z.string().min(1).max(256),
});

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h, matches admin.ts TTL

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Password required." },
      { status: 400 },
    );
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    return NextResponse.json(
      { ok: false, error: "AUTH", message: "Wrong password." },
      { status: 401 },
    );
  }

  const token = await createAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return response;
}
