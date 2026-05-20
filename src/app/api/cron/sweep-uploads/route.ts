import { NextResponse } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { log } from "@/lib/logger";

/**
 * Cron: GET /api/cron/sweep-uploads (every 15min)
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Deletes objects under the `uploads/` prefix that are older than
 * UPLOAD_TTL_MINUTES (120 min / 2 hours). Customer-uploaded reference
 * videos and character images live here; Magnific downloads them
 * within seconds of POST, so the 120-min window is a generous safety
 * margin for retry/regenerate flows.
 *
 * Why 120min instead of R2 bucket lifecycle:
 *   - R2 lifecycle minimum is 1 day. Customer's policy preference is
 *     stricter (less stale data on disk → smaller GDPR/data-retention
 *     surface).
 *   - Cron runs every 15min so worst-case lifetime is 120 + 15 = 135min.
 *
 * Scoping:
 *   - Only `uploads/` prefix. The `videos/` prefix (generated output
 *     mirror) is governed separately by R2's 24h lifecycle rule.
 *   - Hard cap MAX_DELETES_PER_SWEEP (1000) per call — R2's
 *     DeleteObjects API limit. If a sweep ever hits the cap (large
 *     burst) the next 15-min run picks up the rest.
 *
 * Idempotent: rerunning the cron on a clean bucket is a no-op
 * (matched=0, deleted=0).
 */

export const maxDuration = 60;

const PREFIX = "uploads/";
const UPLOAD_TTL_MINUTES = 120;
const MAX_DELETES_PER_SWEEP = 1000;
const SCAN_PAGES = 10; // 10 × 1000 = 10K max objects scanned per run

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_MISCONFIGURED", {
      cron: "sweep-uploads",
      reason: "CRON_SECRET not set",
    });
    return NextResponse.json(
      { error: "MISCONFIGURED", message: "CRON_SECRET not set" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "AUTH", message: "Unauthorized" },
      { status: 401 },
    );
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    log.error("CRON_MISCONFIGURED", {
      cron: "sweep-uploads",
      reason: "R2 env vars missing",
    });
    return NextResponse.json(
      { error: "R2_NOT_CONFIGURED" },
      { status: 500 },
    );
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  const cutoffMs = Date.now() - UPLOAD_TTL_MINUTES * 60_000;
  const matched: string[] = [];
  let scanned = 0;
  let token: string | undefined = undefined;
  let pages = 0;

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
        matched.push(obj.Key);
        if (matched.length >= MAX_DELETES_PER_SWEEP) break scanLoop;
      }
    }
    token = res.NextContinuationToken;
    pages++;
    if (pages >= SCAN_PAGES) break;
  } while (token);

  if (matched.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned,
      matched: 0,
      deleted: 0,
      hitCap: false,
    });
  }

  const delRes = await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: matched.map((k) => ({ Key: k })),
        Quiet: true,
      },
    }),
  );

  const deletedCount = delRes.Deleted?.length ?? matched.length;
  const errors = delRes.Errors ?? [];
  const hitCap = matched.length >= MAX_DELETES_PER_SWEEP;

  log.info("UPLOAD_SWEEP_DONE", {
    ttlMinutes: UPLOAD_TTL_MINUTES,
    scanned,
    matched: matched.length,
    deleted: deletedCount,
    errors: errors.length,
    hitCap,
  });

  return NextResponse.json({
    ok: true,
    scanned,
    matched: matched.length,
    deleted: deletedCount,
    errorCount: errors.length,
    hitCap,
  });
}
