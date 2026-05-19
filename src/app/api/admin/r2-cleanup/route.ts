import { NextResponse } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { requireAdminApi } from "@/lib/auth/admin-server";
import { log } from "@/lib/logger";

/**
 * POST /api/admin/r2-cleanup
 *
 * Manual one-shot cleanup of stale objects under the `videos/` prefix.
 * Backstop for when R2 bucket lifecycle is broken (wrong prefix, slow
 * sweep, etc.) and admin wants stale data gone NOW instead of waiting.
 *
 * Query params:
 *   - `maxAgeHours` (default 48): delete objects older than this
 *   - `dryRun` (default "true"): preview without deleting. MUST pass
 *     `dryRun=false` explicitly to actually delete — guard against
 *     accidental destructive curl.
 *   - `cap` (default 1000, max 1000): max deletions per call.
 *     DeleteObjects API caps at 1000 anyway; we don't loop multiple
 *     batches because admin should re-run if first call hit cap.
 *
 * Response (dry-run + live both):
 *   {
 *     ok, mode: "dry-run" | "live", maxAgeHours, cap,
 *     scanned, matched, sampleKeys: [...first 20],
 *     deleted, deleteErrors: [{ key, code, message }]   (live only)
 *   }
 *
 * Why POST not GET: destructive. GET would be cached by intermediaries
 * + accidentally re-triggered by browser preload. POST forces the
 * caller to be deliberate.
 *
 * Why no DELETE method: REST DELETE on a collection is ambiguous.
 * POST on a "cleanup" resource is clearer about intent.
 *
 * Safety:
 *   - Admin-only (requireAdminApi)
 *   - dryRun=true default
 *   - Hard cap 1000 per call
 *   - Logs every live run with ADMIN_R2_CLEANUP event
 */

export const maxDuration = 60;
const PREFIX = "videos/";
const ABSOLUTE_CAP = 1000;
const SCAN_PAGES = 10; // 10 × 1000 = 10K max objects scanned per call

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(request.url);
  const maxAgeHours = Math.max(
    1,
    Number(url.searchParams.get("maxAgeHours") ?? 48),
  );
  // dryRun defaults to true unless explicitly "false" — safer to err on
  // the side of not deleting when the caller didn't say so clearly.
  const dryRun = url.searchParams.get("dryRun") !== "false";
  const cap = Math.min(
    ABSOLUTE_CAP,
    Math.max(1, Number(url.searchParams.get("cap") ?? ABSOLUTE_CAP)),
  );

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return NextResponse.json(
      { ok: false, error: "R2_NOT_CONFIGURED" },
      { status: 500 },
    );
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const cutoffMs = Date.now() - maxAgeHours * 3_600_000;
  const matched: Array<{ key: string; ageHours: number; sizeMB: number }> = [];
  let scanned = 0;
  let token: string | undefined = undefined;
  let pages = 0;

  // Scan until we either find `cap` matches, hit SCAN_PAGES, or run
  // out of objects. Matches are sorted oldest-first naturally because
  // we accumulate during a chronological scan; no extra sort needed.
  scanLoop: do {
    const res: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      scanned++;
      const ts = new Date(obj.LastModified).getTime();
      if (ts <= cutoffMs) {
        matched.push({
          key: obj.Key,
          ageHours: Number(((Date.now() - ts) / 3_600_000).toFixed(2)),
          sizeMB: Number(((obj.Size ?? 0) / 1_048_576).toFixed(2)),
        });
        if (matched.length >= cap) break scanLoop;
      }
    }
    token = res.NextContinuationToken;
    pages++;
    if (pages >= SCAN_PAGES) break;
  } while (token);

  const sampleKeys = matched.slice(0, 20).map((m) => ({
    key: m.key,
    ageHours: m.ageHours,
    sizeMB: m.sizeMB,
  }));

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      maxAgeHours,
      cap,
      pagesScanned: pages,
      scanned,
      matched: matched.length,
      sampleKeys,
      totalSizeMB: Number(
        matched.reduce((s, m) => s + m.sizeMB, 0).toFixed(2),
      ),
      note: "Dry-run — không xoá gì. Thêm `?dryRun=false` để thực sự xoá.",
    });
  }

  // Live mode — actually delete. DeleteObjects API takes up to 1000
  // keys per call which matches our cap, so single call suffices.
  if (matched.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: "live",
      maxAgeHours,
      cap,
      pagesScanned: pages,
      scanned,
      matched: 0,
      deleted: 0,
      deleteErrors: [],
      note: "Không có object nào match — bucket sạch sẵn rồi.",
    });
  }

  const delRes = await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: matched.map((m) => ({ Key: m.key })),
        Quiet: false,
      },
    }),
  );

  const deletedCount = delRes.Deleted?.length ?? 0;
  const errors = (delRes.Errors ?? []).map((e) => ({
    key: e.Key,
    code: e.Code,
    message: e.Message,
  }));

  log.info("ADMIN_R2_CLEANUP", {
    maxAgeHours,
    cap,
    scanned,
    matched: matched.length,
    deleted: deletedCount,
    errors: errors.length,
  });

  return NextResponse.json({
    ok: true,
    mode: "live",
    maxAgeHours,
    cap,
    pagesScanned: pages,
    scanned,
    matched: matched.length,
    deleted: deletedCount,
    deleteErrors: errors,
    sampleKeys,
    note:
      matched.length >= cap
        ? "Hit cap — chạy lại endpoint để xoá batch tiếp theo."
        : "Đã xoá xong tất cả objects match. Chạy /r2-audit để verify.",
  });
}
