import { describe, it, expect } from "vitest";
import { buildFilename } from "./auto-download";

/**
 * Audit P2-2 covers buildFilename — it's where customer-supplied prompts
 * meet OS filenames, which is exactly where past regressions have hit
 * (Vietnamese diacritics, the slug-15 vs slug-40 swap, the prefix swap).
 *
 * If any of these fail in a future refactor, the customer's Downloads
 * folder gets junk filenames or the OS rejects them.
 */
describe("buildFilename", () => {
  it("puts the slug at the front of the filename", () => {
    const fn = buildFilename({
      tier: "pro",
      prompt: "a cinematic shot of a cat in neon alley",
      createdAt: new Date("2026-05-04T14:30:00Z").getTime(),
    });
    expect(fn).toMatch(/^a-cinematic-sho_kling-pro_\d{8}-\d{4}\.mp4$/);
  });

  it("strips Vietnamese diacritics to ASCII", () => {
    const fn = buildFilename({
      tier: "std",
      prompt: "góc nhìn flycam đường phố Hà Nội",
      createdAt: 0,
    });
    // Should NOT contain any non-ASCII letter
    expect(fn).toMatch(/^[a-z0-9_.\-]+\.mp4$/);
    // Should preserve the prompt's leading slug, just transliterated
    expect(fn.startsWith("goc-nhin-flycam")).toBe(true);
  });

  it("clamps the slug to 15 chars", () => {
    const fn = buildFilename({
      tier: "pro",
      prompt:
        "this is a very long prompt that should be clamped to fifteen chars at the start",
      createdAt: 0,
    });
    const slug = fn.split("_")[0] ?? "";
    expect(slug.length).toBeLessThanOrEqual(15);
  });

  it("falls back to 'video' when the prompt is empty after stripping", () => {
    const fn = buildFilename({
      tier: "std",
      prompt: "!!!!!", // all punctuation → strips to empty
      createdAt: 0,
    });
    expect(fn.startsWith("video_kling-std_")).toBe(true);
  });

  it("includes tier in the metadata segment", () => {
    const a = buildFilename({ tier: "pro", prompt: "x", createdAt: 0 });
    const b = buildFilename({ tier: "std", prompt: "x", createdAt: 0 });
    expect(a).toContain("kling-pro");
    expect(b).toContain("kling-std");
  });

  it("formats the date as YYYYMMDD-HHMM in local time", () => {
    const fn = buildFilename({
      tier: "pro",
      prompt: "x",
      createdAt: new Date("2026-01-09T03:05:00Z").getTime(),
    });
    // We can't assert exact local TZ — but the shape must be 8 digits
    // dash 4 digits, no other punctuation in the date segment.
    expect(fn).toMatch(/_\d{8}-\d{4}\.mp4$/);
  });

  it("preserves a leading tracking code so customers can grep", () => {
    const fn = buildFilename({
      tier: "pro",
      prompt: "ABC123 do this video",
      createdAt: 0,
    });
    expect(fn.startsWith("abc123-do-this")).toBe(true);
  });

  // — New format (taskId passed) — added 2026-05-23 to fix batch
  //   download collisions when customers submit 100 prompts at once.
  describe("with taskId (new format)", () => {
    it("appends 6-char id suffix from the task UUID", () => {
      const fn = buildFilename({
        tier: "pro",
        prompt: "cat at sunset",
        createdAt: new Date("2026-05-23T14:30:52Z").getTime(),
        taskId: "abc12345-def6-7890-1234-56789a4b9c2f",
      });
      // Last 6 hex chars of the de-dashed UUID = "a4b9c2f" → slice(-6) = "4b9c2f"
      expect(fn).toMatch(/_4b9c2f\.mp4$/);
    });

    it("uses 20-char slug instead of 15 when taskId present", () => {
      const fn = buildFilename({
        tier: "pro",
        prompt: "this is a very long prompt that should fit twenty chars",
        createdAt: 0,
        taskId: "11111111-2222-3333-4444-555555555555",
      });
      const slug = fn.split("_")[0] ?? "";
      expect(slug.length).toBeLessThanOrEqual(20);
      expect(slug.length).toBeGreaterThan(15);
    });

    it("uses second-precision timestamp instead of minute-only", () => {
      const fn = buildFilename({
        tier: "pro",
        prompt: "x",
        createdAt: 0,
        taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });
      // YYYYMMDD-HHMMSS = 8 digits dash 6 digits
      expect(fn).toMatch(/_\d{8}-\d{6}_[0-9a-f]{6}\.mp4$/);
    });

    it("two tasks with same prompt + minute but different taskId produce different filenames", () => {
      const base = {
        tier: "pro" as const,
        prompt: "same prompt batch",
        createdAt: new Date("2026-05-23T14:30:00Z").getTime(),
      };
      const a = buildFilename({ ...base, taskId: "11111111-aaaa-bbbb-cccc-dddddd111111" });
      const b = buildFilename({ ...base, taskId: "22222222-aaaa-bbbb-cccc-dddddd222222" });
      expect(a).not.toBe(b);
    });

    it("falls back to legacy format when taskId is null", () => {
      const fn = buildFilename({
        tier: "pro",
        prompt: "x",
        createdAt: 0,
        taskId: null,
      });
      // Legacy format = minute precision (4 digits, not 6)
      expect(fn).toMatch(/_\d{8}-\d{4}\.mp4$/);
    });
  });
});
