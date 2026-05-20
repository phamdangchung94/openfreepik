/**
 * Client-side file upload to temporary public hosts.
 * Uploading directly from the browser bypasses Vercel's 4.5MB body limit.
 *
 * Audit P1-10: hard dependency on a single host (Litterbox) is a known
 * liability — the service can rate-limit or pull access without notice.
 * Mitigations layered here:
 *   - Try `tmpfiles.org` first, fall back to `litterbox.catbox.moe` if
 *     it rejects or times out. One host being down doesn't block the
 *     i2v / motion / start-end-frame upload flow.
 *   - 30s AbortSignal.timeout per host so a slow host doesn't hang the
 *     UI; the failure rolls into the fallback path.
 *   - Vietnamese customer-facing error messages distinguish timeout vs.
 *     connection failure vs. service rejection.
 *
 * **Video support**: Kling Motion Control endpoints need a reference
 * video URL. Litterbox accepts files up to ~1GB (we cap to 50MB to keep
 * customer wait time bounded); tmpfiles is image-only in practice so we
 * skip it for video uploads (would just waste the 30s timeout).
 *
 * Vercel Blob (paid feature) is the right next layer once free hosts
 * become unreliable — deferred until traffic justifies it.
 */

import { useAuthStore } from "@/store/auth-store";

const TMPFILES_API = "https://tmpfiles.org/api/v1/upload";
const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const PRESIGN_API = "/api/upload/presign";
const UPLOAD_TIMEOUT_MS = 30_000;

export interface UploadResult {
  publicUrl: string;
  /** Data URI only for image uploads (used for instant preview); empty for video. */
  dataUri: string;
  filename: string;
}

/**
 * Generic uploader — dispatches to image or video pipeline based on
 * MIME type. Caller passes a File; we infer kind from `file.type`.
 *   - `image/*`  → tmpfiles → litterbox fallback, includes dataUri
 *   - `video/*`  → litterbox only, no dataUri (caller uses
 *     URL.createObjectURL for preview to avoid 50MB base64 bloat)
 *
 * Throws with Vietnamese error message on full failure.
 */
export async function uploadFileToHost(file: File): Promise<UploadResult> {
  if (file.type.startsWith("video/")) return uploadVideoToHost(file);
  // Default to image flow for anything else (backwards-compatible).
  return uploadImageToHost(file);
}

export async function uploadImageToHost(file: File): Promise<UploadResult> {
  const dataUri = await fileToDataUri(file);
  const errors: string[] = [];

  for (const uploader of [uploadToTmpfiles, uploadToLitterbox]) {
    try {
      const publicUrl = await uploader(file);
      return { publicUrl, dataUri, filename: file.name };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Both hosts rejected — surface a Vietnamese top-line message and
  // include the underlying host errors so the customer can show
  // support what went wrong.
  throw new Error(
    `Tải ảnh thất bại — cả 2 dịch vụ tải ảnh đều từ chối. Vui lòng thử lại sau. (${errors.join(" | ")})`,
  );
}

/**
 * Video upload — primary path is presigned PUT to our own R2 bucket
 * (`/api/upload/presign` issues the URL, browser PUTs directly to R2
 * to bypass Vercel's 4.5MB serverless body limit). Litterbox stays as
 * a fallback for envs where R2 isn't configured.
 *
 * Why not third-party fallback chain? catbox.moe and 0x0.st don't
 * return `Access-Control-Allow-Origin` so browser POST fails with
 * "Failed to fetch" before the response is readable (verified via
 * the dev preview on 2026-05-20). Litterbox is the only free host
 * with proper CORS — and the only one that goes dark periodically.
 * R2 + presigned URL is the only reliable browser-direct option.
 *
 * No dataUri (50MB base64 would bloat the React tree); preview uses
 * URL.createObjectURL() on the File directly.
 */
export async function uploadVideoToHost(file: File): Promise<UploadResult> {
  const errors: string[] = [];

  try {
    const publicUrl = await uploadToR2ViaPresign(file);
    return { publicUrl, dataUri: "", filename: file.name };
  } catch (err) {
    errors.push(`r2: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const publicUrl = await uploadToLitterbox(file);
    return { publicUrl, dataUri: "", filename: file.name };
  } catch (err) {
    errors.push(`litterbox: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(
    `Tải video thất bại — cả R2 và dịch vụ dự phòng đều không hoạt động. Vui lòng thử lại sau. (${errors.join(" | ")})`,
  );
}

/**
 * Upload to our own R2 bucket via a presigned PUT URL. Two-step:
 *   1. POST {filename, contentType, size} to /api/upload/presign
 *      → server issues a short-lived (5min) presigned PUT URL + key
 *      → server returns the public URL too (R2 publicUrlBase + key)
 *   2. Browser PUTs the raw file bytes to the presigned URL
 *      → R2 stores it; bucket lifecycle expires after 24h
 *
 * Bypasses Vercel's 4.5MB serverless body limit because the PUT
 * goes browser → R2 directly, not through our function.
 */
async function uploadToR2ViaPresign(file: File): Promise<string> {
  // Read activation code from the auth store directly — uploadVideoToHost
  // runs in the browser so .getState() is safe outside React. If empty
  // (not activated), the route returns 401 and we fall back to litterbox.
  const bearer = useAuthStore.getState().activationCode;
  if (!bearer) {
    throw new Error("not activated — activation code required for R2 upload");
  }

  const presignRes = await fetch(PRESIGN_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("video/") ? "video" : "image",
    }),
  });

  if (!presignRes.ok) {
    const body = await readResponseText(presignRes);
    throw new Error(`presign HTTP ${presignRes.status}: ${body}`);
  }

  const presign = (await presignRes.json()) as {
    uploadUrl?: string;
    publicUrl?: string;
    error?: string;
    message?: string;
  };
  if (!presign.uploadUrl || !presign.publicUrl) {
    throw new Error(
      `presign rejected: ${presign.message ?? presign.error ?? "no upload URL"}`,
    );
  }

  // Distinguish PUT-step failures from presign failures so the customer
  // and devs can see exactly where the chain broke. CORS-blocked PUTs
  // surface as "Failed to fetch" with no further detail — surface the
  // R2 host so the operator can verify CORS rule on that exact endpoint.
  const uploadHost = (() => {
    try { return new URL(presign.uploadUrl).host; } catch { return "?"; }
  })();
  let putRes: Response;
  try {
    putRes = await fetchWithTimeout(presign.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PUT to ${uploadHost} failed: ${msg}`);
  }

  if (!putRes.ok) {
    throw new Error(
      `PUT to ${uploadHost} HTTP ${putRes.status}: ${await readResponseText(putRes)}`,
    );
  }

  return presign.publicUrl;
}

async function uploadToTmpfiles(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const res = await fetchWithTimeout(TMPFILES_API, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(
      `tmpfiles HTTP ${res.status}: ${await readResponseText(res)}`,
    );
  }

  const json = (await res.json()) as {
    status?: string;
    data?: { url?: string };
    message?: string;
  };
  const url = json.data?.url;
  if (json.status !== "success" || !url) {
    throw new Error(
      `tmpfiles rejected upload: ${json.message ?? "empty response"}`,
    );
  }

  return toTmpfilesDownloadUrl(url);
}

async function uploadToLitterbox(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("reqtype", "fileupload");
  formData.append("time", "24h");
  formData.append("fileToUpload", file, file.name);

  const res = await fetchWithTimeout(LITTERBOX_API, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(
      `litterbox HTTP ${res.status}: ${await readResponseText(res)}`,
    );
  }

  const url = (await res.text()).trim();
  if (!url.startsWith("http")) {
    throw new Error(`litterbox rejected upload: ${url || "empty response"}`);
  }

  return url;
}


/**
 * Wraps fetch with a per-call timeout that maps to a friendly error
 * message instead of the raw DOMException name. Both hosts use this so
 * the fallback path treats timeouts and HTTP errors uniformly.
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("upload timed out (30s)");
    }
    throw new Error(
      err instanceof Error ? err.message : "network error",
    );
  }
}

/**
 * tmpfiles.org returns a viewer URL like `https://tmpfiles.org/123/img.png`.
 * Freepik needs the *download* URL (`/dl/123/img.png`) to actually
 * fetch the bytes — without `/dl/` it gets back HTML.
 */
function toTmpfilesDownloadUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = "https:";
  if (parsed.hostname === "tmpfiles.org" && !parsed.pathname.startsWith("/dl/")) {
    parsed.pathname = `/dl${parsed.pathname}`;
  }
  return parsed.toString();
}

async function readResponseText(res: Response): Promise<string> {
  const text = (await res.text()).trim().replace(/\s+/g, " ");
  if (!text) return "empty response";
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
