import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { vouchers, type NewVoucher } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import {
  generateVoucherCode,
  TIER_CONFIG,
  type VoucherTier,
} from "@/lib/vouchers/format";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/vouchers/bulk — mint N vouchers of one tier in one
 * transaction. Same pattern as /api/admin/codes/bulk.
 *
 * Body: { tier: "100k" | "200k" | "500k", count: 1..200, batchLabel?: string }
 *
 * Returns: { ok: true, created: [{ id, code, tier, vndValue, eurValue }, ...] }
 *
 * Unique-code collision guard: the random portion has 31^8 ≈ 10^12
 * combinations. With at most 200 vouchers per call and the unique
 * index in place, collision is statistically negligible. On the rare
 * INSERT conflict, we retry the whole batch once (cheaper than
 * iterating per-row).
 */

const MAX_BULK = 200;

const bulkSchema = z.object({
  tier: z.enum(["100k", "200k", "500k"]),
  count: z.number().int().min(1).max(MAX_BULK),
  batchLabel: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await parseJsonBody(request);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: "Validation failed.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { tier, count, batchLabel } = parsed.data;
  const cfg = TIER_CONFIG[tier as VoucherTier];

  const rows = buildRows(tier as VoucherTier, count, batchLabel ?? null, cfg);

  // Retry once on rare unique-code collision. After that, surface 500 —
  // the same collision pattern recurring twice indicates a CSPRNG
  // problem worth investigating, not silently absorbing.
  let inserted: Awaited<ReturnType<typeof insertBatch>>;
  try {
    inserted = await insertBatch(rows);
  } catch (err) {
    log.warn("VOUCHERS_BULK_RETRY", { tier, count, err: String(err) });
    inserted = await insertBatch(
      buildRows(tier as VoucherTier, count, batchLabel ?? null, cfg),
    );
  }

  log.info("VOUCHERS_BULK_CREATED", {
    tier,
    count: inserted.length,
    batchLabel: batchLabel ?? null,
  });

  return NextResponse.json({ ok: true, created: inserted });
}

function buildRows(
  tier: VoucherTier,
  count: number,
  batchLabel: string | null,
  cfg: { vndValue: number; eurValue: number },
): NewVoucher[] {
  const rows: NewVoucher[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      code: generateVoucherCode(tier),
      tier,
      vndValue: cfg.vndValue,
      eurValue: cfg.eurValue.toFixed(2),
      batchLabel,
    });
  }
  return rows;
}

async function insertBatch(rows: NewVoucher[]) {
  return await db.transaction(async (tx) => {
    return tx
      .insert(vouchers)
      .values(rows)
      .returning({
        id: vouchers.id,
        code: vouchers.code,
        tier: vouchers.tier,
        vndValue: vouchers.vndValue,
        eurValue: vouchers.eurValue,
        batchLabel: vouchers.batchLabel,
      });
  });
}
