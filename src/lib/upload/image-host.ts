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

const TMPFILES_API = "https://tmpfiles.org/api/v1/upload";
const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
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
 * Video upload — Litterbox only. Skip tmpfiles since it's image-only
 * in practice (would waste the 30s timeout on every call). No dataUri
 * (50MB base64 would slow down the React tree); preview should use
 * URL.createObjectURL() on the File directly.
 */
export async function uploadVideoToHost(file: File): Promise<UploadResult> {
  try {
    const publicUrl = await uploadToLitterbox(file);
    return { publicUrl, dataUri: "", filename: file.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Tải video thất bại — dịch vụ tải video đang không hoạt động. Vui lòng thử lại sau. (${msg})`,
    );
  }
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
