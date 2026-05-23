import { NextResponse } from "next/server";
import { z } from "zod";
import { presignUpload } from "@/lib/storage/r2";
import { requireApiKey } from "@/lib/auth/api-key-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/freepik/route-helpers";
import { apiError, apiSuccess } from "@/lib/api-v1/response";
import { errFields, log } from "@/lib/logger";

/**
 * POST /api/v1/upload
 *
 * Issue a short-lived presigned PUT URL for direct R2 upload. Use this
 * to host the reference image/video that Motion or Omni endpoints need
 * as `image_url` / `video_url` / `start_image_url` — saves customers
 * from running their own file hosting.
 *
 * Auth: Bearer sk_*
 * Body: { filename, contentType, size, kind: "video"|"image" }
 *
 * Response:
 *   {
 *     ok: true,
 *     upload_url: "https://...",       — PUT here with raw bytes + same contentType
 *     public_url: "https://pub-.../X", — pass this back as image_url/video_url
 *     key: "image/abc-...",            — R2 object key (admin-side)
 *     expires_at: "ISO-8601"           — upload_url validity (~10 min)
 *   }
 *
 * Flow:
 *   1. POST /v1/upload → get upload_url + public_url
 *   2. PUT upload_url with the file bytes + matching Content-Type
 *   3. POST /v1/video/... with `params.image_url = public_url`
 *
 * Bucket lifecycle deletes uploaded references 2 hours after PUT, so
 * fire the video POST quickly. Generated outputs from Magnific live
 * 24 hours and are managed separately.
 */

const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB

const inputSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  size: z.number().int().min(1),
  kind: z.enum(["video", "image"]),
});

const RATE_LIMIT = 12;
const RATE_WINDOW_SEC = 60;

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const body = await parseJsonBody(request);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      status: 400,
      error: "BAD_REQUEST",
      message: "Validation failed.",
      requestId: auth.requestId,
      extra: { issues: parsed.error.issues },
    });
  }

  const { filename, contentType, size, kind } = parsed.data;
  const cap = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > cap) {
    return apiError({
      status: 413,
      error: "FILE_TOO_LARGE",
      message: `File ${Math.round(size / 1024 / 1024)}MB exceeds the ${Math.round(cap / 1024 / 1024)}MB cap for ${kind}.`,
      requestId: auth.requestId,
    });
  }

  const expectedPrefix = kind === "video" ? "video/" : "image/";
  if (!contentType.toLowerCase().startsWith(expectedPrefix)) {
    return apiError({
      status: 400,
      error: "BAD_REQUEST",
      message: `contentType "${contentType}" doesn't match kind="${kind}". Expected something starting with "${expectedPrefix}".`,
      requestId: auth.requestId,
    });
  }

  const rl = await checkRateLimit({
    resource: "v1-upload",
    scope: auth.apiKeyId,
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SEC,
  });
  if (!rl.allowed) {
    return apiError({
      status: 429,
      error: "RATE_LIMIT",
      message: `Limit ${RATE_LIMIT} uploads / ${RATE_WINDOW_SEC}s — retry in ${rl.retryAfterSeconds}s.`,
      requestId: auth.requestId,
      rateLimit: rl,
      headers: { "retry-after": String(rl.retryAfterSeconds) },
    });
  }

  let presigned;
  try {
    presigned = await presignUpload({
      contentType,
      kind,
      extension: filename.split(".").pop(),
    });
  } catch (err) {
    log.error("V1_UPLOAD_PRESIGN_FAILED", {
      requestId: auth.requestId,
      apiKeyId: auth.apiKeyId,
      kind,
      ...errFields(err),
    });
    return apiError({
      status: 500,
      error: "PRESIGN_FAILED",
      message: "Couldn't generate upload URL — try again.",
      requestId: auth.requestId,
      rateLimit: rl,
    });
  }

  if (!presigned) {
    return apiError({
      status: 503,
      error: "STORAGE_NOT_CONFIGURED",
      message: "Upload storage not configured. Contact support.",
      requestId: auth.requestId,
      rateLimit: rl,
    });
  }

  return apiSuccess({
    requestId: auth.requestId,
    rateLimit: rl,
    data: {
      ok: true,
      upload_url: presigned.uploadUrl,
      public_url: presigned.publicUrl,
      key: presigned.key,
      expires_at: presigned.expiresAt,
    },
  });
}
