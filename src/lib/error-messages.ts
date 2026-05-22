/**
 * Map server error codes / common API messages to friendly Vietnamese.
 * Falls back to the original message when nothing matches, so unknown
 * errors still surface — never swallow info, just translate the known
 * ones.
 */

// Keys here MUST match the codes the server actually emits. Audit
// P2-13: previously CODE_NOT_FOUND/CODE_REVOKED/CODE_EXPIRED/RATE_LIMITED
// were documented but never matched — orchestrator emits NOT_FOUND /
// INACTIVE / EXPIRED / RATE_LIMIT (no CODE_ prefix). Both shapes are
// listed below so neither old nor new emit names go untranslated.
const CODE_MAP: Record<string, string> = {
  ALL_KEYS_EXHAUSTED:
    "Hệ thống đang quá tải — vui lòng liên hệ hỗ trợ.",
  NO_KEYS_AVAILABLE:
    "Tạm thời chưa có key khả dụng — vui lòng thử lại sau.",
  INSUFFICIENT_BALANCE:
    "Mã kích hoạt không đủ số dư cho video này.",
  PRICING_MISSING:
    "Cấu hình giá tạm thời không khả dụng — vui lòng liên hệ hỗ trợ.",
  UPSTREAM_MALFORMED:
    "Máy chủ trả về dữ liệu lỗi — đã hoàn tiền, vui lòng thử lại.",
  PLAN_LIMIT:
    "Hệ thống đang chạm giới hạn nhà cung cấp — vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
  AUTH: "Bạn cần kích hoạt mã trước khi tạo video.",
  // Both legacy CODE_* and current bare names map to the same string.
  NOT_FOUND: "Không tìm thấy mã kích hoạt.",
  CODE_NOT_FOUND: "Không tìm thấy mã kích hoạt.",
  INACTIVE: "Mã kích hoạt đã bị thu hồi.",
  CODE_REVOKED: "Mã kích hoạt đã bị thu hồi.",
  EXPIRED: "Mã kích hoạt đã hết hạn.",
  CODE_EXPIRED: "Mã kích hoạt đã hết hạn.",
  RATE_LIMIT: "Quá nhiều yêu cầu — vui lòng chờ một chút.",
  RATE_LIMITED: "Quá nhiều yêu cầu — vui lòng chờ một chút.",
  TIMEOUT: "Tạo video quá thời gian — vui lòng thử lại.",
  UNKNOWN: "Có lỗi không xác định — vui lòng thử lại.",
  // Upstream returned status=COMPLETED but generated[] was empty —
  // typically Magnific's safety filter silently rejected the prompt
  // (political figures, violence, NSFW…). Hệ thống đã auto-refund.
  COMPLETED_WITHOUT_URL:
    "Nội dung có thể vi phạm chính sách AI — vui lòng đổi ngữ cảnh/từ ngữ trong prompt (tránh nhân vật chính trị, bạo lực, NSFW) rồi tạo lại. Đã hoàn tiền.",
  // Upstream returned status=FAILED explicitly. Could be model error,
  // bad image input, or temporary outage. Đã auto-refund.
  MAGNIFIC_FAILED:
    "Máy chủ AI báo lỗi xử lý — thử đổi prompt hoặc ảnh nguồn rồi tạo lại. Đã hoàn tiền.",
  UPSTREAM_FAILED:
    "Máy chủ AI báo lỗi xử lý — thử đổi prompt hoặc ảnh nguồn rồi tạo lại. Đã hoàn tiền.",
  MISSING_URL:
    "Máy chủ AI hoàn tất nhưng không trả về video — vui lòng tạo lại. Đã hoàn tiền.",
  // Cron orphan sweeper detected a stuck `pending` row >cutoff and
  // refunded. Webhook may have been lost or upstream still working.
  ORPHAN_CHARGE_AUTO_REFUNDED:
    "Hệ thống không nhận được phản hồi từ máy chủ AI trong thời gian chờ — đã tự hoàn tiền. Vui lòng tạo lại.",
  // Webhook-path variants (same root cause as above but discovered via
  // Magnific's push callback instead of our polling loop).
  COMPLETED_WITHOUT_URL_VIA_WEBHOOK:
    "Nội dung có thể vi phạm chính sách AI — vui lòng đổi ngữ cảnh/từ ngữ trong prompt (tránh nhân vật chính trị, bạo lực, NSFW) rồi tạo lại. Đã hoàn tiền.",
  MAGNIFIC_FAILED_VIA_WEBHOOK:
    "Máy chủ AI báo lỗi xử lý — thử đổi prompt hoặc ảnh nguồn rồi tạo lại. Đã hoàn tiền.",
};

const PHRASE_MAP: Array<[RegExp, string]> = [
  [/insufficient balance/i, "Mã kích hoạt không đủ số dư cho video này."],
  // Pool-state phrases (legacy "freepik" + new neutral wording both caught).
  [
    /all (freepik|upstream) (keys|credits) (ran out|exhausted)/i,
    "Hệ thống đang quá tải — vui lòng liên hệ hỗ trợ.",
  ],
  [
    /no (freepik|active video) (keys|credits)/i,
    "Tạm thời chưa có key khả dụng — vui lòng thử lại sau.",
  ],
  [
    /(freepik|upstream) refused|key (likely )?suspended|account suspended|unexpected http 403/i,
    "Hệ thống đang gặp sự cố tạm thời — vui lòng thử lại sau ít phút.",
  ],
  // Free-trial / plan-limit (Magnific 429 message). Map to a neutral
  // "out of credits" line so the brand never reaches the customer.
  [
    /free trial|trial usage|upgrade.*paid|paid plan|usage limit|api plan|plan limit/i,
    "Hệ thống tạm thời hết credit — vui lòng thử lại sau.",
  ],
  [/activation code is required/i, "Bạn cần kích hoạt mã trước khi tạo video."],
  [/activation code/i, "Mã kích hoạt không hợp lệ."],
  // Rate-limit string format from rate-limit.ts / route-helpers.ts.
  // Captures the retry-after seconds so the customer sees a concrete
  // wait time instead of a vague "try later".
  [
    /limit \d+ requests per \d+s\. wait (\d+)s and retry/i,
    "Quá nhiều yêu cầu — vui lòng chờ $1 giây rồi thử lại.",
  ],
  // Activate route uses a slightly shorter shape.
  [
    /too many attempts\. wait (\d+)s and retry/i,
    "Quá nhiều lần thử — vui lòng chờ $1 giây rồi thử lại.",
  ],
  // Polling too fast — extra wording from createTaskGetHandler.
  [
    /polling too fast — wait (\d+)s/i,
    "Đang kiểm tra trạng thái quá nhanh — vui lòng chờ $1 giây.",
  ],
  [/network|fetch failed|enotfound|timeout/i, "Lỗi mạng — vui lòng kiểm tra kết nối và thử lại."],
  [/generation failed/i, "Tạo video thất bại — vui lòng thử lại."],
  [/interrupted before submission/i, "Bị gián đoạn trước khi gửi — vui lòng tạo lại."],
  [/recovered/i, "(đã khôi phục)"],
];

/**
 * Strip upstream brand names from any message that's about to be shown
 * to the customer. Defense-in-depth — base-client.ts also sanitizes at
 * extract time, but this pass catches anything that bypasses the API
 * layer (e.g. log strings copy-pasted into errors, future regressions).
 */
export function stripBrandNames(s: string): string {
  return s
    .replace(/\bMagnific\b/gi, "máy chủ AI")
    .replace(/\bFreepik\b/gi, "máy chủ AI")
    .replace(/https?:\/\/(?:www\.)?(?:magnific|freepik)\.com\S*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function friendlyError(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Direct code match (e.g. "ALL_KEYS_EXHAUSTED")
  const upper = trimmed.toUpperCase();
  if (CODE_MAP[upper]) return CODE_MAP[upper];

  // Phrase-pattern match against the raw message. If the translation
  // string contains `$1`/`$2` etc., substitute the captured groups
  // (used for rate-limit messages that need to surface the retry-after
  // seconds inline).
  for (const [pattern, vi] of PHRASE_MAP) {
    if (!pattern.test(trimmed)) continue;
    if (vi.includes("$")) {
      return trimmed.replace(pattern, vi);
    }
    return vi;
  }

  // Unknown — return the original so devs can still debug, BUT scrub
  // brand names first so the customer never sees "Magnific" or "Freepik"
  // in a fallthrough error.
  return stripBrandNames(trimmed);
}
