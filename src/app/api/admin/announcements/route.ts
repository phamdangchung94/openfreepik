import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { announcements } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * Admin CRUD for broadcast announcements.
 *
 * GET    /api/admin/announcements        → list all (active + inactive)
 * POST   /api/admin/announcements        → create
 * PATCH  /api/admin/announcements?id=X   → update
 * DELETE /api/admin/announcements?id=X   → delete (hard)
 *
 * Customers hit the separate, public /api/announcements which filters
 * to active + non-expired.
 */
const SEVERITIES = ["info", "warn", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

function sanitizeBody(input: unknown) {
  if (!input || typeof input !== "object") {
    return { error: "Invalid body" as const };
  }
  const o = input as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!title || !body) {
    return { error: "title + body required" as const };
  }
  const severity = isSeverity(o.severity) ? o.severity : "info";
  const ctaLabel =
    typeof o.ctaLabel === "string" && o.ctaLabel.trim()
      ? o.ctaLabel.trim().slice(0, 80)
      : null;
  // Only http(s) URLs allowed — avoids javascript: / data: links being
  // shoved into the banner CTA by a compromised admin session.
  let ctaUrl: string | null = null;
  if (typeof o.ctaUrl === "string" && o.ctaUrl.trim()) {
    const trimmed = o.ctaUrl.trim();
    if (/^(https?:\/\/|\/)/.test(trimmed)) {
      ctaUrl = trimmed.slice(0, 500);
    }
  }
  const active = o.active === undefined ? true : Boolean(o.active);
  let expiresAt: Date | null = null;
  if (o.expiresAt) {
    const d = new Date(o.expiresAt as string);
    if (!Number.isNaN(d.getTime())) expiresAt = d;
  }
  return {
    data: {
      title: title.slice(0, 200),
      body: body.slice(0, 2000),
      ctaLabel,
      ctaUrl,
      severity,
      active,
      expiresAt,
    },
  };
}

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rows = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt));
  return NextResponse.json({ ok: true, announcements: rows });
}

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const json = await request.json().catch(() => null);
  const parsed = sanitizeBody(json);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const [row] = await db
    .insert(announcements)
    .values(parsed.data)
    .returning();
  return NextResponse.json({ ok: true, announcement: row });
}

export async function PATCH(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = sanitizeBody(json);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const [row] = await db
    .update(announcements)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(announcements.id, id))
    .returning();
  if (!row) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, announcement: row });
}

export async function DELETE(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  await db.delete(announcements).where(eq(announcements.id, id));
  return NextResponse.json({ ok: true });
}
