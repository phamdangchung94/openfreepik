/**
 * Single-admin password auth + DB-backed session tokens.
 *
 * Password is checked against ADMIN_PASSWORD (env). On match we mint a 32-byte
 * random token, store its SHA-256 in admin_sessions, and return the raw token
 * to the caller (cookie value). Lookup hashes the cookie value and matches
 * against the table row, expiring after 24h.
 */

import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { adminSessions } from "@/lib/db/schema";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const ADMIN_COOKIE_NAME = "openfreepik-admin";

export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error("ADMIN_PASSWORD env var is not set");
  }
  // Plain string compare — single password, not a high-value timing target
  // (attacker would need to guess the entire 16-char random string anyway).
  return typeof password === "string" && password === expected;
}

export async function createAdminSession(): Promise<string> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(adminSessions).values({ tokenHash, expiresAt });
  return token;
}

/** Returns true if the cookie token maps to a non-expired session row. */
export async function validateAdminSession(token: string | null): Promise<boolean> {
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return false;
  if (row.expiresAt.getTime() <= Date.now()) {
    // Lazy cleanup of the expired row.
    await db
      .delete(adminSessions)
      .where(eq(adminSessions.tokenHash, tokenHash));
    return false;
  }
  return true;
}

export async function destroyAdminSession(token: string | null): Promise<void> {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
}

/** Best-effort cleanup of all expired sessions; safe to ignore failures. */
export async function purgeExpiredSessions(): Promise<void> {
  await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, sql`now()`));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
