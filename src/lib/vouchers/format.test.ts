import { describe, it, expect } from "vitest";
import {
  generateVoucherCode,
  maskVoucherCode,
  normalizeVoucherCode,
  parseVoucherCode,
  TIER_CONFIG,
} from "./format";

/**
 * Voucher code format is customer-facing AND security-critical:
 *   - Customers TYPE it from a phone screen — ambiguous chars (O/0/I/1)
 *     must never appear
 *   - Anti-bruteforce relies on the format predicate filtering obvious
 *     garbage before hitting the DB — regression here = wasted rate
 *     budget + slightly easier brute-force surface
 *   - parseVoucherCode must NEVER accept the activation-code format
 *     ("FK-XXXXX-XXXXX-...") — would let typo-confusion across types
 */
describe("generateVoucherCode", () => {
  it("emits CODE-{tier}-{8 chars} matching the documented shape", () => {
    for (const tier of ["100k", "200k", "500k"] as const) {
      const code = generateVoucherCode(tier);
      expect(code).toMatch(/^CODE-(100|200|500)-[A-Z2-9]{8}$/);
    }
  });

  it("excludes ambiguous chars O, 0, I, 1, L from the random portion", () => {
    // Generate enough samples to hit every position
    for (let i = 0; i < 200; i++) {
      const code = generateVoucherCode("100k");
      const random = code.split("-")[2] ?? "";
      expect(random).not.toMatch(/[O0I1L]/);
    }
  });

  it("places the tier segment between two dashes", () => {
    const code = generateVoucherCode("500k");
    expect(code.startsWith("CODE-500-")).toBe(true);
  });

  it("is reversibly parseable via parseVoucherCode", () => {
    for (const tier of ["100k", "200k", "500k"] as const) {
      const code = generateVoucherCode(tier);
      expect(parseVoucherCode(code)).toBe(tier);
    }
  });
});

describe("parseVoucherCode", () => {
  it("accepts well-formed codes for each tier", () => {
    expect(parseVoucherCode("CODE-100-X4K9MPQR")).toBe("100k");
    expect(parseVoucherCode("CODE-200-7HJTBNZW")).toBe("200k");
    expect(parseVoucherCode("CODE-500-PQ3RFGHK")).toBe("500k");
  });

  it("rejects activation code format (FK-...-...)", () => {
    // Critical: must not cross-validate.
    expect(parseVoucherCode("FK-LJYDH-ALTBA-TPK-Y-UBVLA")).toBe(null);
  });

  it("rejects malformed shapes", () => {
    expect(parseVoucherCode("CODE-100-")).toBe(null);
    expect(parseVoucherCode("CODE-150-X4K9MPQR")).toBe(null); // bad tier segment
    expect(parseVoucherCode("CODE-100-X4K9MPQ")).toBe(null); // 7 chars not 8
    expect(parseVoucherCode("CODE-100-X4K9MPQRZ")).toBe(null); // 9 chars
    expect(parseVoucherCode("CODE_100_X4K9MPQR")).toBe(null); // underscores not dashes
    expect(parseVoucherCode("code-100-X4K9MPQR")).toBe(null); // lowercase prefix
  });

  it("rejects codes containing ambiguous chars in random portion", () => {
    // Even if the regex allowed them, parser predicate guards against
    // OCR-failure-style typos. The character class [A-Z2-9] explicitly
    // excludes 0 and 1.
    expect(parseVoucherCode("CODE-100-X4K90PQR")).toBe(null); // contains 0
    expect(parseVoucherCode("CODE-100-X4K91PQR")).toBe(null); // contains 1
  });
});

describe("normalizeVoucherCode", () => {
  it("uppercases the input so customers can paste lowercase", () => {
    expect(normalizeVoucherCode("code-100-x4k9mpqr")).toBe(
      "CODE-100-X4K9MPQR",
    );
  });

  it("strips surrounding whitespace and curly quotes", () => {
    expect(normalizeVoucherCode("  CODE-100-X4K9MPQR  ")).toBe(
      "CODE-100-X4K9MPQR",
    );
    expect(normalizeVoucherCode('"CODE-100-X4K9MPQR"')).toBe(
      "CODE-100-X4K9MPQR",
    );
  });

  it("normalizes to a value that survives parseVoucherCode", () => {
    const normalized = normalizeVoucherCode(" code-100-x4k9mpqr \n");
    expect(parseVoucherCode(normalized)).toBe("100k");
  });
});

describe("maskVoucherCode", () => {
  it("keeps prefix + last 4 random chars visible", () => {
    expect(maskVoucherCode("CODE-100-X4K9MPQR")).toBe("CODE-100-***MPQR");
  });

  it("returns *** for malformed input rather than echoing back", () => {
    expect(maskVoucherCode("garbage")).toBe("***");
  });
});

describe("TIER_CONFIG", () => {
  it("matches the confirmed 1:1 ratio for all three tiers", () => {
    // 100k VND → 100 EUR, 200k → 200, 500k → 500
    expect(TIER_CONFIG["100k"]).toEqual({
      vndValue: 100_000,
      eurValue: 100,
      codeSegment: "100",
    });
    expect(TIER_CONFIG["200k"]).toEqual({
      vndValue: 200_000,
      eurValue: 200,
      codeSegment: "200",
    });
    expect(TIER_CONFIG["500k"]).toEqual({
      vndValue: 500_000,
      eurValue: 500,
      codeSegment: "500",
    });
  });
});
