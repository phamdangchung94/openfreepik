import { NextResponse } from "next/server";
import { z } from "zod";
import { presignUpload } from "@/lib/storage/r2";
import { validateCode } from "@/lib/auth/activation";
import {
  extractActivationCode,
  parseJsonBody,
} from "@/lib/freepik/route-helpers";
import { extractApiKey, validateApiKey } from "@/lib/auth/api-key";
import { checkRateLimit } from "@/lib/rate-limit";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/upload/presign
 *
 * Issue a short-lived presigned PUT URL for the browser to upload a
 * file directly to R2. Used by the motion reference video flow + the
 * I2V character image flow when Vercel's 4.5MB serverless body limit
 * would otherwise truncate the upload.
 *
 * Auth: accepts either an activation code (web UI) or an API key
 * (programmatic — `Authorization: Bearer sk_*`). Rate-limited per
 * principal to prevent presign abuse.
 *
 * Body: { filename, contentType, size, kind: "video"|"image" }
 * Response: { ok: true, uploadUrl, publicUrl, key, expiresAt }
 */

const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB cushion above the 50MB client cap
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const inputSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(1),
  kind: z.enum(["video", "image"]),
});

const RATE_LIMIT = 12;
const RATE_WINDOW_SEC = 60;

export async function POST(request: Request) {
  // Auth — accept either credential type. Reuse the existing
  // validators so revoked codes/keys can't issue uploads.
  const apiKey = extractApiKey(request);
  let principal: string | null = null;
  if (apiKey) {
    const v = await validateApiKey(apiKey);
    if (!v.ok) {
      return NextResponse.json(
        { ok: false, error: "AUTH", message: "Invalid API key." },
        { status: 401 },
      );
    }
    principal = `key:${v.apiKeyId}`;
  } else {
    const bearer = extractActivationCode(request);
    if (!bearer) {
      return NextResponse.json(
        { ok: false, error: "AUTH", message: "Missing credentials." },
        { status: 401 },
      );
    }
    const v = await validateCode(bearer);
    if (!v.ok) {
      return NextResponse.json(
        { ok: false, error: "AUTH", message: "Invalid activation code." },
        { status: 401 },
      );
    }
    principal = `code:${v.metadata.codeId}`;
  }

  const body = await parseJsonBody(request);
  const parsed = inputSchema.safeParse(body);
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

  const { filename, contentType, size, kind } = parsed.data;
  const cap = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > cap) {
    return NextResponse.json(
      {
        ok: false,
        error: "FILE_TOO_LARGE",
        message: `File ${Math.round(size / 1024 / 1024)}MB vượt giới hạn ${Math.round(cap / 1024 / 1024)}MB.`,
      },
      { status: 413 },
    );
  }

  const expectedPrefix = kind === "video" ? "video/" : "image/";
  if (!contentType.toLowerCase().startsWith(expectedPrefix)) {
    return NextResponse.json(
      {
        ok: false,
        error: "BAD_REQUEST",
        message: `contentType ${contentType} không khớp kind=${kind}.`,
      },
      { status: 400 },
    );
  }

  const rl = await checkRateLimit({
    resource: "upload-presign",
    scope: principal,
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SEC,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT",
        message: `Giới hạn ${RATE_LIMIT} upload/${RATE_WINDOW_SEC}s — thử lại sau ${rl.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  let presigned;
  try {
    presigned = await presignUpload({
      contentType,
      kind,
      extension: filename.split(".").pop(),
    });
  } catch (err) {
    log.error("PRESIGN_FAILED", { principal, kind, ...errFields(err) });
    return NextResponse.json(
      {
        ok: false,
        error: "PRESIGN_FAILED",
        message: "Không thể tạo URL upload — thử lại sau.",
      },
      { status: 500 },
    );
  }

  if (!presigned) {
    return NextResponse.json(
      {
        ok: false,
        error: "STORAGE_NOT_CONFIGURED",
        message: "Storage chưa cấu hình.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, ...presigned });
}
