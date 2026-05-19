import { NextResponse } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { requireAdminApi } from "@/lib/auth/admin-server";

/**
 * GET /api/admin/r2-audit
 *
 * Admin-only audit of the R2 bucket: lists lifecycle rules and computes
 * an age distribution of objects under the `videos/` prefix. Surfaces
 * the oldest object so a misconfigured lifecycle (e.g. wrong prefix
 * shape like "/videos" vs "videos/") is obvious — anything >48h old
 * means the auto-delete rule didn't match.
 *
 * Why this exists: the bucket is short-TTL (currently 24h) but a typo
 * in the lifecycle Prefix field will silently leave the bucket growing
 * forever. Without an audit endpoint we'd only notice via Cloudflare
 * billing or by clicking through the dashboard. This endpoint is a
 * 5-second self-check.
 *
 * Caps:
 *   - Scans at most 5000 objects per call (enough for a 24h bucket;
 *     more = paginated separately if needed later).
 *   - 60s function budget for the loop.
 *
 * Response shape (all ages in hours):
 *   {
 *     ok, bucket, totalObjects, totalSizeGB,
 *     ageBuckets: { "<=6h", "6-12h", "12-24h", "24-48h", ">48h" },
 *     oldest: { key, ageHours, sizeMB } | null,
 *     lifecycleRules: [{ id, status, prefix, expirationDays, ... }],
 *     verdict: "ok" | "stragglers_24-48h" | "broken_>48h" | "no_objects",
 *   }
 */

export const maxDuration = 60;
const SCAN_CAP = 5000;
const PREFIX = "videos/";

interface AgeBuckets {
  "<=6h": number;
  "6-12h": number;
  "12-24h": number;
  "24-48h": number;
  ">48h": number;
}

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return NextResponse.json(
      {
        ok: false,
        error: "R2_NOT_CONFIGURED",
        message: "Missing R2_* env vars. Mirror is disabled.",
      },
      { status: 500 },
    );
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  // 1. Lifecycle rules — surface what's actually applied so admin can
  //    cross-check the dashboard against reality.
  let lifecycleRules: Array<{
    id: string | undefined;
    status: string | undefined;
    prefix: string;
    expirationDays: number | undefined;
    abortMultipartDays: number | undefined;
  }> = [];
  let lifecycleError: string | null = null;
  try {
    const lc = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    lifecycleRules = (lc.Rules ?? []).map((rule: LifecycleRule) => ({
      id: rule.ID,
      status: rule.Status,
      // Prefix can be at the rule root (legacy) or inside Filter
      // (modern). Surface both possibilities + (all) when empty so
      // typo bugs like "/videos" are visible verbatim.
      prefix:
        rule.Filter && "Prefix" in rule.Filter && rule.Filter.Prefix
          ? rule.Filter.Prefix
          : rule.Prefix
            ? rule.Prefix
            : "(all objects)",
      expirationDays: rule.Expiration?.Days,
      abortMultipartDays: rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
    }));
  } catch (err) {
    lifecycleError = err instanceof Error ? err.message : String(err);
  }

  // 2. Scan up to SCAN_CAP objects under videos/. Track age + size.
  const buckets: AgeBuckets = {
    "<=6h": 0,
    "6-12h": 0,
    "12-24h": 0,
    "24-48h": 0,
    ">48h": 0,
  };
  let totalObjects = 0;
  let totalBytes = 0;
  let oldest: { key: string; ageHours: number; sizeMB: number } | null = null;
  let token: string | undefined = undefined;
  let pages = 0;

  do {
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
      totalObjects++;
      totalBytes += obj.Size ?? 0;
      const ageH =
        (Date.now() - new Date(obj.LastModified).getTime()) / 3_600_000;
      if (ageH <= 6) buckets["<=6h"]++;
      else if (ageH <= 12) buckets["6-12h"]++;
      else if (ageH <= 24) buckets["12-24h"]++;
      else if (ageH <= 48) buckets["24-48h"]++;
      else buckets[">48h"]++;
      if (!oldest || ageH > oldest.ageHours) {
        oldest = {
          key: obj.Key,
          ageHours: Number(ageH.toFixed(2)),
          sizeMB: Number(((obj.Size ?? 0) / 1_048_576).toFixed(2)),
        };
      }
    }
    token = res.NextContinuationToken;
    pages++;
    // Defensive caps — at 1000/page × 5 pages = 5000 objects max.
    if (totalObjects >= SCAN_CAP) break;
  } while (token);

  // 3. Verdict — surface the obvious answer so admin doesn't have to
  //    interpret the numbers.
  let verdict:
    | "ok"
    | "stragglers_24-48h"
    | "broken_>48h"
    | "no_objects";
  if (totalObjects === 0) verdict = "no_objects";
  else if (buckets[">48h"] > 0) verdict = "broken_>48h";
  else if (buckets["24-48h"] > 0) verdict = "stragglers_24-48h";
  else verdict = "ok";

  return NextResponse.json({
    ok: true,
    bucket,
    scannedAt: new Date().toISOString(),
    prefix: PREFIX,
    totalObjects,
    totalSizeGB: Number((totalBytes / 1_073_741_824).toFixed(2)),
    pages,
    capped: totalObjects >= SCAN_CAP,
    ageBuckets: buckets,
    oldest,
    lifecycleRules,
    lifecycleError,
    verdict,
    verdictMeaning: {
      ok: "Tất cả objects <= 24h — lifecycle rule chạy đúng",
      "stragglers_24-48h":
        "Có objects 24-48h tuổi — bình thường, R2 chạy lifecycle theo daily sweep nên objects qua mốc 1day có thể tồn tại thêm tối đa 24h trước khi sweep tiếp theo xoá",
      "broken_>48h":
        "Có objects > 48h tuổi — rule không chạy hoặc prefix sai (vd: '/videos' thay vì 'videos/' hay để trống). Check lifecycleRules[].prefix ở trên",
      no_objects: "Bucket trống (không có object dưới prefix 'videos/')",
    }[verdict],
  });
}
