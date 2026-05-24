import { describe, it, expect, afterEach } from "vitest";
import {
  isLegacyEndpointDisabled,
  legacyGoneBody,
  parseDisabledSet,
} from "./legacy-gate";

const ORIGINAL_ENV = process.env.DISABLE_LEGACY_MODELS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.DISABLE_LEGACY_MODELS;
  } else {
    process.env.DISABLE_LEGACY_MODELS = ORIGINAL_ENV;
  }
});

describe("parseDisabledSet", () => {
  it("returns empty for undefined", () => {
    expect(parseDisabledSet(undefined).size).toBe(0);
  });

  it("returns empty for empty string", () => {
    expect(parseDisabledSet("").size).toBe(0);
    expect(parseDisabledSet("   ").size).toBe(0);
  });

  it("splits comma-separated slugs", () => {
    const set = parseDisabledSet("wan-v27,kling-omni");
    expect(set.has("wan-v27")).toBe(true);
    expect(set.has("kling-omni")).toBe(true);
  });

  it("trims whitespace + lowercases", () => {
    const set = parseDisabledSet("  WAN-v27 ,  Kling-Omni  ");
    expect(set.has("wan-v27")).toBe(true);
    expect(set.has("kling-omni")).toBe(true);
  });

  it("expands 'all' to every known legacy slug", () => {
    const set = parseDisabledSet("all");
    expect(set.has("wan-v27")).toBe(true);
    expect(set.has("kling-omni")).toBe(true);
    expect(set.has("kling-omni-std-video")).toBe(true);
    expect(set.has("kling-omni-pro-reference")).toBe(true);
  });
});

describe("isLegacyEndpointDisabled", () => {
  it("returns false when env not set", () => {
    delete process.env.DISABLE_LEGACY_MODELS;
    expect(isLegacyEndpointDisabled("wan-v27")).toBe(false);
    expect(isLegacyEndpointDisabled("kling-omni-std-video")).toBe(false);
  });

  it("blocks specific slug when env contains it", () => {
    process.env.DISABLE_LEGACY_MODELS = "wan-v27";
    expect(isLegacyEndpointDisabled("wan-v27")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-std-video")).toBe(false);
  });

  it("'kling-omni' prefix covers all 4 omni variants", () => {
    process.env.DISABLE_LEGACY_MODELS = "kling-omni";
    expect(isLegacyEndpointDisabled("kling-omni-std-video")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-pro-video")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-std-reference")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-pro-reference")).toBe(true);
    // Doesn't leak to other models
    expect(isLegacyEndpointDisabled("wan-v27")).toBe(false);
    expect(isLegacyEndpointDisabled("kling-v3")).toBe(false);
  });

  it("'all' blocks every known legacy slug", () => {
    process.env.DISABLE_LEGACY_MODELS = "all";
    expect(isLegacyEndpointDisabled("wan-v27")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-std-video")).toBe(true);
    expect(isLegacyEndpointDisabled("kling-omni-pro-reference")).toBe(true);
    // Non-legacy models stay allowed
    expect(isLegacyEndpointDisabled("kling-v3")).toBe(false);
    expect(isLegacyEndpointDisabled("kling-4k-t2v")).toBe(false);
  });

  it("never blocks active models", () => {
    process.env.DISABLE_LEGACY_MODELS = "all";
    expect(isLegacyEndpointDisabled("kling-v3")).toBe(false);
    expect(isLegacyEndpointDisabled("kling-4k-t2v")).toBe(false);
    expect(isLegacyEndpointDisabled("kling-motion-v3-pro")).toBe(false);
    expect(isLegacyEndpointDisabled("improve-prompt")).toBe(false);
  });
});

describe("legacyGoneBody", () => {
  it("includes the slug and a replacement when given", () => {
    const body = legacyGoneBody("wan-v27", "kling-v3");
    expect(body.ok).toBe(false);
    expect(body.error).toBe("ENDPOINT_DEPRECATED");
    expect(body.message).toContain("wan-v27");
    expect(body.message).toContain("kling-v3");
  });

  it("falls back to a generic message when no replacement", () => {
    const body = legacyGoneBody("wan-v27");
    expect(body.message).toContain("wan-v27");
    expect(body.message).toContain("hỗ trợ");
  });
});
