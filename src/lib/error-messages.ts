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
    "Freepik trả về không đúng định dạng — đã hoàn tiền, vui lòng thử lại.",
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
};

const PHRASE_MAP: Array<[RegExp, string]> = [
  [/insufficient balance/i, "Mã kích hoạt không đủ số dư cho video này."],
  [/all freepik keys ran out/i, "Hệ thống đang quá tải — vui lòng liên hệ hỗ trợ."],
  [/no freepik keys/i, "Tạm thời chưa có key khả dụng — vui lòng thử lại sau."],
  [/freepik refused|key (likely )?suspended|account suspended|unexpected http 403/i, "Hệ thống đang gặp sự cố tạm thời — vui lòng thử lại sau ít phút."],
  [/activation code is required/i, "Bạn cần kích hoạt mã trước khi tạo video."],
  [/activation code/i, "Mã kích hoạt không hợp lệ."],
  [/network|fetch failed|enotfound|timeout/i, "Lỗi mạng — vui lòng kiểm tra kết nối và thử lại."],
  [/generation failed/i, "Tạo video thất bại — vui lòng thử lại."],
  [/interrupted before submission/i, "Bị gián đoạn trước khi gửi — vui lòng tạo lại."],
  [/recovered/i, "(đã khôi phục)"],
];

export function friendlyError(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Direct code match (e.g. "ALL_KEYS_EXHAUSTED")
  const upper = trimmed.toUpperCase();
  if (CODE_MAP[upper]) return CODE_MAP[upper];

  // Phrase-pattern match against the raw message.
  for (const [pattern, vi] of PHRASE_MAP) {
    if (pattern.test(trimmed)) return vi;
  }

  // Unknown — return the original so devs can still debug.
  return trimmed;
}
