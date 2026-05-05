import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { freepikKeys } from "@/lib/db/schema";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { probeKeyQuota } from "@/lib/freepik/probe-quota";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/keys/refresh-all-quotas
 *
 * Probes every key (active OR inactive — admin may want to verify
 * before reactivating) in parallel. Returns one entry per key with
 * its captured headers + auth result. Each probe has its own 10s
 * timeout, so a stuck Magnific won't block the whole batch.
 */
export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const keys = await db
    .select({
      id: freepikKeys.id,
      label: freepikKeys.label,
      keyEncrypted: freepikKeys.keyEncrypted,
      isActive: freepikKeys.isActive,
    })
    .from(freepikKeys);

  const start = Date.now();
  const results = await Promise.all(
    keys.map(async (k) => {
      const probe = await probeKeyQuota(k.keyEncrypted);
      return {
        id: k.id,
        label: k.label,
        isActive: k.isActive,
        probe,
      };
    }),
  );

  log.info("KEYS_QUOTA_PROBE_ALL", {
    count: results.length,
    elapsedMs: Date.now() - start,
    summary: results.map((r) => ({
      label: r.label,
      status: r.probe.status,
      ok: r.probe.ok,
    })),
  });

  return NextResponse.json({ ok: true, count: results.length, results });
}
