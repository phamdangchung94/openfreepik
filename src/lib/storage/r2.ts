/**
 * Cloudflare R2 mirror helper.
 *
 * Why we mirror: Magnific's video URL is short-lived (24h estimate, no
 * official spec). After that, the customer's "Tải về" button breaks.
 * Mirroring to R2 lets us:
 *   - Serve via Cloudflare's CDN (faster from VN than Magnific's S3)
 *   - Control TTL (currently 24h via R2 lifecycle rule "auto-delete-6h"
 *     on the bucket — rule name is stale, action is 1 day)
 *   - Keep the original Magnific URL as fallback (db column unchanged)
 *
 * R2 is S3-compatible — we use the AWS SDK V3 with R2's S3 endpoint.
 *
 * Required env vars (configured on Vercel):
 *   R2_ACCOUNT_ID         — Cloudflare account ID
 *   R2_ACCESS_KEY_ID      — S3-API access key from R2 dashboard
 *   R2_SECRET_ACCESS_KEY  — S3-API secret (paired with above)
 *   R2_BUCKET             — bucket name (e.g. "openfreepik")
 *   R2_PUBLIC_URL_BASE    — public r2.dev URL (e.g. https://pub-XXX.r2.dev)
 *
 * If any var is missing the helpers no-op gracefully so the customer
 * flow never breaks because of a misconfigured mirror.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { errFields, log } from "@/lib/logger";
import { randomUUID } from "crypto";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrlBase: string;
}

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrlBase = process.env.R2_PUBLIC_URL_BASE;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrlBase) {
    return null;
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    // Trim trailing slash so `${base}/${key}` produces a clean URL
    // regardless of how the env var was entered.
    publicUrlBase: publicUrlBase.replace(/\/$/, ""),
  };
}

let cachedClient: S3Client | null = null;

function getClient(cfg: R2Config): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cachedClient;
}

/** Whether R2 mirror is enabled (all env vars present). */
export function isR2Configured(): boolean {
  return readConfig() !== null;
}

/**
 * Stream-fetch a remote URL and PUT into R2. Returns the public R2
 * URL on success, null on any failure (caller falls back to original).
 */
export async function mirrorRemoteToR2(opts: {
  /** Source URL (Magnific signed CDN link). */
  sourceUrl: string;
  /** Object key in the bucket — e.g. "videos/<taskId>.mp4". */
  key: string;
  /** Content-Type to set on the R2 object. */
  contentType: string;
}): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) {
    log.warn("R2_NOT_CONFIGURED", { key: opts.key });
    return null;
  }

  // Stream → buffer. R2 PutObject needs a known length OR a stream that
  // exposes Content-Length; the simplest reliable path is buffering.
  // 30MB videos fit comfortably in Vercel Pro function memory (1GB+).
  const fetchStart = Date.now();
  let bytes: Uint8Array;
  let actualContentType = opts.contentType;
  try {
    const res = await fetch(opts.sourceUrl, {
      // 60s timeout — large videos over slow Magnific CDN
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      log.warn("R2_MIRROR_SOURCE_BAD", {
        key: opts.key,
        status: res.status,
      });
      return null;
    }
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
    // Prefer the upstream Content-Type if it's specific (caller passes
    // a fallback like "video/mp4" but Magnific might return application/json
    // for an error page — trust the response when it's actually media).
    const upstreamCt = res.headers.get("content-type");
    if (upstreamCt && /^(video|image)\//i.test(upstreamCt)) {
      actualContentType = upstreamCt;
    }
  } catch (err) {
    log.warn("R2_MIRROR_FETCH_FAILED", {
      key: opts.key,
      ...errFields(err),
    });
    return null;
  }
  const fetchMs = Date.now() - fetchStart;

  const uploadStart = Date.now();
  try {
    const client = getClient(cfg);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: opts.key,
        Body: bytes,
        ContentType: actualContentType,
        ContentLength: bytes.length,
        CacheControl: "public, max-age=21600", // 6h, matches lifecycle
      }),
    );
  } catch (err) {
    log.warn("R2_MIRROR_PUT_FAILED", {
      key: opts.key,
      sizeBytes: bytes.length,
      ...errFields(err),
    });
    return null;
  }
  const uploadMs = Date.now() - uploadStart;

  log.info("R2_MIRROR_OK", {
    key: opts.key,
    sizeBytes: bytes.length,
    fetchMs,
    uploadMs,
    contentType: actualContentType,
  });

  return `${cfg.publicUrlBase}/${opts.key}`;
}

/**
 * Build the standard R2 object key for a Kling video.
 * Format: videos/<taskId>.mp4 — flat, easy to inspect from the R2 UI.
 */
export function r2KeyForVideo(taskId: string): string {
  return `videos/${taskId}.mp4`;
}

export interface PresignedUpload {
  /** Short-lived PUT URL the browser uploads to directly. */
  uploadUrl: string;
  /** Permanent public R2 URL once the PUT succeeds (subject to lifecycle TTL). */
  publicUrl: string;
  /** Object key used. */
  key: string;
  /** ISO timestamp the upload URL expires. */
  expiresAt: string;
}

/**
 * Issue a short-lived presigned PUT URL so the browser can upload
 * directly to R2 without going through Vercel's 4.5MB serverless
 * body limit. Used by `/api/upload/presign`.
 *
 * Returns null when R2 isn't configured (local dev without env vars);
 * caller falls back to a free public host.
 *
 * `kind` selects the bucket prefix: `video/` for motion reference
 * videos (24h lifecycle), `image/` for character images (24h
 * lifecycle). Both share the existing R2 bucket; the prefix lets us
 * apply different lifecycle rules later without migration.
 */
export async function presignUpload(opts: {
  contentType: string;
  kind: "video" | "image";
  extension?: string;
}): Promise<PresignedUpload | null> {
  const cfg = readConfig();
  if (!cfg) {
    log.warn("R2_NOT_CONFIGURED", { presign: true });
    return null;
  }

  const ext = sanitizeExtension(opts.extension, opts.contentType, opts.kind);
  const prefix = opts.kind === "video" ? "uploads/video" : "uploads/image";
  const key = `${prefix}/${randomUUID()}.${ext}`;

  const client = getClient(cfg);
  const ttlSeconds = 300; // 5min — enough for a 50MB upload over slow VN mobile

  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: opts.contentType,
    }),
    { expiresIn: ttlSeconds },
  );

  return {
    uploadUrl,
    publicUrl: `${cfg.publicUrlBase}/${key}`,
    key,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

function sanitizeExtension(
  extension: string | undefined,
  contentType: string,
  kind: "video" | "image",
): string {
  // Allowlist: only extensions we expect — avoids path traversal via
  // the `extension` param.
  const allowed = kind === "video"
    ? ["mp4", "mov", "webm", "m4v"]
    : ["jpg", "jpeg", "png", "webp", "gif"];

  const cleaned = (extension ?? "").replace(/^\.+/, "").toLowerCase();
  if (cleaned && allowed.includes(cleaned)) return cleaned;

  // Derive from contentType if extension was missing/unsafe.
  const ctMap: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-m4v": "m4v",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return ctMap[contentType.toLowerCase()] ?? (kind === "video" ? "mp4" : "jpg");
}
