import { describe, it, expect } from "vitest";
import { friendlyError } from "./error-messages";

/**
 * Audit P2-2: friendlyError is what the customer sees when something
 * goes wrong. Past audit P2-13 caught a key-mismatch bug here that
 * fell back to raw English — these tests pin both shapes.
 */
describe("friendlyError", () => {
  it("returns empty for null/empty/whitespace", () => {
    expect(friendlyError(null)).toBe("");
    expect(friendlyError(undefined)).toBe("");
    expect(friendlyError("")).toBe("");
    expect(friendlyError("   ")).toBe("");
  });

  it("translates ALL_KEYS_EXHAUSTED to Vietnamese", () => {
    expect(friendlyError("ALL_KEYS_EXHAUSTED")).toContain("Hệ thống đang quá tải");
  });

  it("translates orchestrator's bare codes (NOT_FOUND, EXPIRED, INACTIVE, RATE_LIMIT)", () => {
    // Audit P2-13: these are what validateCode actually emits
    expect(friendlyError("NOT_FOUND")).toContain("Không tìm thấy");
    expect(friendlyError("EXPIRED")).toContain("hết hạn");
    expect(friendlyError("INACTIVE")).toContain("thu hồi");
    expect(friendlyError("RATE_LIMIT")).toContain("Quá nhiều");
  });

  it("translates legacy CODE_* aliases too (back-compat)", () => {
    expect(friendlyError("CODE_NOT_FOUND")).toContain("Không tìm thấy");
    expect(friendlyError("CODE_EXPIRED")).toContain("hết hạn");
    expect(friendlyError("CODE_REVOKED")).toContain("thu hồi");
    expect(friendlyError("RATE_LIMITED")).toContain("Quá nhiều");
  });

  it("phrase-matches insufficient-balance message", () => {
    expect(
      friendlyError("Activation code has insufficient balance for this request."),
    ).toContain("không đủ số dư");
  });

  it("translates the rate-limit creator-route message and preserves the wait seconds", () => {
    const out = friendlyError("Limit 3 requests per 60s. Wait 32s and retry.");
    expect(out).toContain("Quá nhiều yêu cầu");
    expect(out).toContain("32 giây");
    // Brand sanitizer should not fire on this path — make sure the
    // literal upstream brand isn't snuck in by a future regression.
    expect(out).not.toMatch(/Magnific|Freepik/i);
  });

  it("translates the activate-route too-many-attempts message", () => {
    const out = friendlyError("Too many attempts. Wait 15s and retry.");
    expect(out).toContain("Quá nhiều lần thử");
    expect(out).toContain("15 giây");
  });

  it("translates the polling-too-fast message", () => {
    const out = friendlyError("Polling too fast — wait 3s.");
    expect(out).toContain("3 giây");
  });

  it("phrase-matches network errors", () => {
    expect(friendlyError("fetch failed: ENOTFOUND")).toContain("Lỗi mạng");
    expect(friendlyError("Request timeout")).toContain("Lỗi mạng");
  });

  it("phrase-matches Freepik 403 family", () => {
    expect(friendlyError("Unexpected HTTP 403")).toContain("sự cố tạm thời");
    expect(friendlyError("Freepik refused the request")).toContain(
      "sự cố tạm thời",
    );
  });

  it("falls back to original message when nothing matches", () => {
    expect(friendlyError("some-unknown-error-text")).toBe("some-unknown-error-text");
  });

  it("is case-insensitive on phrase patterns", () => {
    expect(friendlyError("ACTIVATION CODE IS REQUIRED")).toContain(
      "kích hoạt",
    );
  });
});
