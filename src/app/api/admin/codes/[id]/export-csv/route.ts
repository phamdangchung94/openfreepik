import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activationCodes, freepikKeys, usageLogs } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/codes/[id]/export-csv — full usage history for one code
 * as CSV. Cap at 5000 rows to keep the response under Vercel's payload
 * budget; admin can filter to a time window if a customer accumulates
 * more than that (we'll add that later if needed).
 *
 * Columns chosen to be reconcilable with bookkeeping: timestamp, EUR
 * cost, endpoint, tier, duration, status, prompt, task id.
 */

const ROW_CAP = 5000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const [code] = await db
    .select({
      id: activationCodes.id,
      code: activationCodes.code,
      customerLabel: activationCodes.customerLabel,
    })
    .from(activationCodes)
    .where(eq(activationCodes.id, id))
    .limit(1);
  if (!code) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await db
    .select({
      createdAt: usageLogs.createdAt,
      endpoint: usageLogs.endpoint,
      tier: usageLogs.tier,
      durationSeconds: usageLogs.durationSeconds,
      withAudio: usageLogs.withAudio,
      costEur: usageLogs.costEur,
      status: usageLogs.status,
      prompt: usageLogs.prompt,
      errorMessage: usageLogs.errorMessage,
      freepikTaskId: usageLogs.freepikTaskId,
      keyLabel: freepikKeys.label,
    })
    .from(usageLogs)
    .leftJoin(freepikKeys, eq(usageLogs.keyId, freepikKeys.id))
    .where(eq(usageLogs.codeId, id))
    .orderBy(desc(usageLogs.createdAt))
    .limit(ROW_CAP);

  // Build CSV — UTF-8 with BOM so Excel detects encoding correctly,
  // RFC-4180 escaping (double-quotes around any field with commas /
  // newlines / quotes; embedded quotes doubled).
  const header = [
    "created_at",
    "endpoint",
    "tier",
    "duration_s",
    "with_audio",
    "cost_eur",
    "status",
    "key_label",
    "task_id",
    "prompt",
    "error_message",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        toIso(r.createdAt),
        csv(r.endpoint),
        csv(r.tier ?? ""),
        r.durationSeconds ?? "",
        r.withAudio ? "yes" : "no",
        r.costEur,
        csv(r.status),
        csv(r.keyLabel ?? ""),
        csv(r.freepikTaskId ?? ""),
        csv(r.prompt ?? ""),
        csv(r.errorMessage ?? ""),
      ].join(","),
    );
  }
  const body = "﻿" + lines.join("\n");

  const filename = sanitizeFilename(
    `usage-${code.customerLabel ?? code.id.slice(0, 8)}.csv`,
  );

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function csv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^\w.-]/g, "_");
}
