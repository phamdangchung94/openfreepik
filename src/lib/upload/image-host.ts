/**
 * Client-side image upload — uploads directly from browser to litterbox.catbox.moe.
 * Bypasses Vercel's 4.5MB serverless body size limit.
 *
 * Audit P1-10: hard dependency on Litterbox is a known liability — they
 * can rate-limit or pull the service without notice. Mitigations here:
 *   - 30s timeout via AbortSignal so the UI doesn't hang forever
 *   - clear customer-facing error messages so they know to retry
 *
 * Vercel Blob fallback is the right next step but it's a paid feature
 * (counts against Hobby's free quota differently); deferred to when
 * the customer actually hits Litterbox flakiness.
 */

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const UPLOAD_TIMEOUT_MS = 30_000;

export interface UploadResult {
  publicUrl: string;
  dataUri: string;
  filename: string;
}

export async function uploadImageToHost(file: File): Promise<UploadResult> {
  const dataUri = await fileToDataUri(file);

  const formData = new FormData();
  formData.append("reqtype", "fileupload");
  formData.append("time", "24h");
  formData.append("fileToUpload", file, file.name);

  let res: Response;
  try {
    res = await fetch(LITTERBOX_API, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout throws DOMException name=TimeoutError; other
    // network failures throw TypeError. Both deserve the same friendly
    // message — neither is actionable by the customer beyond "try again".
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        "Upload quá thời gian (30s). Mạng yếu hoặc dịch vụ tải ảnh đang chậm — vui lòng thử lại.",
      );
    }
    throw new Error(
      "Không kết nối được dịch vụ tải ảnh. Kiểm tra mạng và thử lại.",
    );
  }

  if (!res.ok) {
    throw new Error(`Upload thất bại (HTTP ${res.status}). Vui lòng thử lại.`);
  }

  const url = (await res.text()).trim();
  if (!url.startsWith("http")) {
    throw new Error(`Upload thất bại: ${url || "không có response"}`);
  }

  return { publicUrl: url, dataUri, filename: file.name };
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
