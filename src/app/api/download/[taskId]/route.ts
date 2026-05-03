/**
 * Server-side download proxy.
 *
 * Why we need this: the browser ignores the `download` attribute on an
 * `<a>` tag when href points to a cross-origin URL. Freepik's CDN serves
 * videos with `Content-Type: video/mp4` and no `Content-Disposition`, so
 * a direct link just plays the video inline in a new tab. To force a
 * file-save dialog, the response must come from our own origin AND
 * include `Content-Disposition: attachment`.
 *
 * This route:
 *   - validates the activation code via Bearer header
 *   - confirms the requested freepikTaskId belongs to the caller (no URL
 *     guessing)
 *   - confirms the video URL hasn't expired
 *   - streams the upstream Freepik response straight back to the client
 *     with a download-forcing Content-Disposition
 *
 * Range requests are forwarded so the browser's resume / seek-while-
 * downloading still works.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usageLogs } from "@/lib/db/schema";
import { extractActivationCode } from "@/lib/freepik/route-helpers";
import { validateCode } from "@/lib/auth/activation";
import { errFields, log } from "@/lib/logger";

// Generous Vercel function timeout; large videos (~30MB) can take 5-10s
// over a slow connection. The Hobby tier maxes out at 60s anyway.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  if (!taskId) {
    return Response.json(
      { error: "BAD_REQUEST", message: "taskId is required." },
      { status: 400 },
    );
  }

  const code = extractActivationCode(request);
  if (!code) {
    return Response.json(
      { error: "AUTH", message: "Activation code is required." },
      { status: 401 },
    );
  }

  const validation = await validateCode(code);
  if (!validation.ok) {
    return Response.json(
      { error: validation.reason.toUpperCase(), message: "Auth failed." },
      { status: 401 },
    );
  }

  // Lookup the row — scoped to the caller's codeId so a stolen taskId
  // can't be used to download someone else's video.
  const [row] = await db
    .select({
      videoUrl: usageLogs.videoUrl,
      expiresAt: usageLogs.videoUrlExpiresAt,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.codeId, validation.metadata.codeId),
        eq(usageLogs.freepikTaskId, taskId),
      ),
    )
    .limit(1);

  if (!row?.videoUrl) {
    return Response.json(
      { error: "NOT_FOUND", message: "Video chưa sẵn sàng hoặc không tồn tại." },
      { status: 404 },
    );
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: "EXPIRED", message: "Link đã hết hạn." },
      { status: 410 },
    );
  }

  // Forward Range header so seek + resume work. Most browsers don't send
  // Range on a download click, but `<video src="">` does — we re-use this
  // route as a fallback player source if Freepik CORS rejects the inline
  // <video> tag (currently the player goes direct, but this is future-proof).
  const upstreamHeaders: HeadersInit = {};
  const range = request.headers.get("range");
  if (range) upstreamHeaders["Range"] = range;

  let upstream: Response;
  try {
    upstream = await fetch(row.videoUrl, { headers: upstreamHeaders });
  } catch (err) {
    log.error("DOWNLOAD_PROXY_FETCH_FAILED", {
      taskId,
      ...errFields(err),
    });
    return Response.json(
      { error: "UPSTREAM", message: "Không lấy được video từ Freepik." },
      { status: 502 },
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    log.warn("DOWNLOAD_PROXY_UPSTREAM_BAD", {
      taskId,
      upstreamStatus: upstream.status,
    });
    return Response.json(
      { error: "UPSTREAM", message: `Upstream ${upstream.status}.` },
      { status: 502 },
    );
  }

  // Build the saved-file name. We don't have the original prompt here
  // (usage_logs doesn't store it), so the filename uses the task ID +
  // tier marker. The CLIENT can override with a friendlier filename via
  // its own anchor; this header is the worst-case fallback the browser
  // uses if no client-side filename is set.
  const filename = `kling-${taskId}.mp4`;

  const out = new Headers();
  out.set("Content-Type", upstream.headers.get("Content-Type") ?? "video/mp4");
  out.set(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  // Forward useful streaming headers when present.
  const len = upstream.headers.get("Content-Length");
  if (len) out.set("Content-Length", len);
  const accept = upstream.headers.get("Accept-Ranges");
  if (accept) out.set("Accept-Ranges", accept);
  const cr = upstream.headers.get("Content-Range");
  if (cr) out.set("Content-Range", cr);
  // Don't cache aggressively — TTL is 24h but clients shouldn't pin the
  // bytes locally beyond a session.
  out.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
