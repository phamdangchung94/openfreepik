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
import { VIDEO_URL_TTL_MS } from "@/lib/video-url-ttl";

/**
 * Allowlist for the `url=` fallback query param. The client sends a
 * URL it already has in localStorage when the DB row is missing one.
 * Restricting to Freepik hosts means a bored user can't turn this
 * into an open proxy by editing their browser request.
 */
function isAllowedFreepikUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return u.host === "freepik.com" || u.host.endsWith(".freepik.com");
  } catch {
    return false;
  }
}

// Generous Vercel function timeout; large videos (~30MB) can take 5-10s
// over a slow connection. Fluid runtime (Vercel default for Next 16) caps
// at 300s so 60s here is comfortable.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    return await handle(request, params);
  } catch (err) {
    const { taskId } = (await params.catch(() => ({ taskId: "?" }))) as { taskId: string };
    log.error("DOWNLOAD_PROXY_500", { taskId, ...errFields(err) });
    const e = err as Error;
    return Response.json(
      {
        error: "INTERNAL",
        message: "Lỗi nội bộ — vui lòng thử lại.",
        debug: {
          name: e?.name ?? "unknown",
          msg: String(e?.message ?? err).slice(0, 400),
        },
      },
      { status: 500 },
    );
  }
}

async function handle(
  request: Request,
  params: Promise<{ taskId: string }>,
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

  // Resolve the upstream URL. Preferred: row.videoUrl (server-recorded
  // when the poll endpoint observed COMPLETED). Fallback: a `url=`
  // query param the client passes from its localStorage copy of the
  // task. Why we need this fallback: rows from before migration 0002
  // applied have video_url=NULL because the UPDATE silently failed on
  // a missing column. The client still has the URL on disk, so let
  // it ride — but only if the URL points at Freepik (no open proxy).
  let upstreamUrl: string | null = row?.videoUrl ?? null;
  if (!upstreamUrl && row) {
    const fallback = new URL(request.url).searchParams.get("url");
    if (fallback && isAllowedFreepikUrl(fallback)) {
      upstreamUrl = fallback;
      // Best-effort backfill: persist the URL we got from the client so
      // future downloads + cross-device hydration stop relying on the
      // client-side fallback. Don't await — UPDATE failures shouldn't
      // block the customer's download.
      const expiresAtMs = Date.now() + VIDEO_URL_TTL_MS;
      void db
        .update(usageLogs)
        .set({
          videoUrl: fallback,
          videoUrlExpiresAt: new Date(expiresAtMs),
        })
        .where(
          and(
            eq(usageLogs.codeId, validation.metadata.codeId),
            eq(usageLogs.freepikTaskId, taskId),
          ),
        )
        .catch((err) =>
          log.warn("DOWNLOAD_PROXY_BACKFILL_FAILED", {
            taskId,
            ...errFields(err),
          }),
        );
    }
  }

  if (!upstreamUrl) {
    return Response.json(
      { error: "NOT_FOUND", message: "Video chưa sẵn sàng hoặc không tồn tại." },
      { status: 404 },
    );
  }

  // neon-http returns timestamptz as ISO string; node-postgres returns
  // Date. Normalise to ms so the comparison works either way. Note:
  // `row` is guaranteed defined here because if it were undefined the
  // upstreamUrl resolution block would have returned 404 above.
  if (row?.expiresAt) {
    const expiresMs =
      row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : Date.parse(String(row.expiresAt));
    if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
      return Response.json(
        { error: "EXPIRED", message: "Link đã hết hạn." },
        { status: 410 },
      );
    }
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
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });
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

  // Response constructor accepts statuses 200-599. Freepik CDN should
  // only return 200/206 here (we already filtered 4xx/5xx above), but
  // guard anyway — a non-standard upstream status would otherwise throw
  // a RangeError that bubbles up as a generic 500 to the customer.
  const safeStatus =
    upstream.status >= 200 && upstream.status <= 599 ? upstream.status : 200;

  return new Response(upstream.body, {
    status: safeStatus,
    headers: out,
  });
}
