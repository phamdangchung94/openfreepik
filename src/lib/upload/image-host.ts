/**
 * Client-side image upload — uploads directly from browser to litterbox.catbox.moe.
 * Bypasses Vercel's 4.5MB serverless body size limit.
 */

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";

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

  const res = await fetch(LITTERBOX_API, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed (HTTP ${res.status}). Please try again.`);
  }

  const url = (await res.text()).trim();
  if (!url.startsWith("http")) {
    throw new Error(`Upload failed: ${url || "empty response"}`);
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
