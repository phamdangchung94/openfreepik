import { NextResponse } from "next/server";
import { saveUploadedImage } from "@/lib/upload/image-host";

/**
 * POST /api/upload
 * Accepts multipart/form-data with one or more "file" fields.
 * Returns: { files: [{ publicUrl, dataUri, filename }] }
 *
 * Maximum 20 files, each up to 10MB.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 20;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("file");

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided." },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES} files per upload.` },
        { status: 400 }
      );
    }

    const results = [];

    for (const file of files) {
      if (!(file instanceof File)) {
        continue;
      }

      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: `Unsupported file type: ${file.type}. Allowed: JPG, PNG, WebP.`,
          },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds 10MB limit.` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await saveUploadedImage(buffer, file.name, file.type);
      results.push(result);
    }

    return NextResponse.json({ files: results });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json(
      { error: "Failed to process upload." },
      { status: 500 }
    );
  }
}
