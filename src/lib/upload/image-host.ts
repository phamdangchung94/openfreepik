/**
 * Image hosting service — uploads to a temporary public host so
 * Freepik's servers can fetch the image via URL.
 *
 * Uses litterbox.catbox.moe (free, no auth, 24h expiry).
 * No local filesystem save — compatible with serverless (Vercel).
 */

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";

export interface UploadResult {
  /** Publicly reachable URL (hosted on litterbox) */
  publicUrl: string;
  /** Base64 data URI for client-side preview */
  dataUri: string;
  /** Original filename */
  filename: string;
}

/**
 * Upload an image to a public host and return the public URL.
 * No local file storage — fully serverless compatible.
 */
export async function saveUploadedImage(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<UploadResult> {
  const ext = originalName.split(".").pop() ?? "jpg";
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;

  const base64 = buffer.toString("base64");
  const dataUri = `data:${mimeType};base64,${base64}`;

  // Upload to public host (litterbox — 24h TTL)
  const publicUrl = await uploadToLitterbox(buffer, filename, mimeType);

  return {
    publicUrl,
    dataUri,
    filename,
  };
}

/**
 * Upload a file buffer to litterbox.catbox.moe (24h temporary hosting).
 */
async function uploadToLitterbox(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  try {
    const uint8 = new Uint8Array(buffer);
    const blob = new Blob([uint8], { type: mimeType });
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", "24h");
    formData.append("fileToUpload", blob, filename);

    const res = await fetch(LITTERBOX_API, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Litterbox upload failed: HTTP ${res.status}`);
    }

    const url = (await res.text()).trim();
    if (!url.startsWith("http")) {
      throw new Error(`Unexpected response: ${url}`);
    }

    return url;
  } catch (err) {
    console.error("[image-host] Litterbox upload failed:", err);
    throw new Error(
      "Failed to upload image to public host. Please use a direct image URL instead."
    );
  }
}
