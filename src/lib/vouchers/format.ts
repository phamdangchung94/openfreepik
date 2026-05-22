/**
 * Voucher code generation + parsing.
 *
 * Format: `CODE-{tier}-{8 random chars}` e.g. `CODE-100-X4K9MPQR`.
 *
 *   - Prefix `CODE-` makes vouchers visually distinct from activation
 *     codes (which are 32+ char random strings).
 *   - Tier `100`/`200`/`500` lets the customer SEE the denomination
 *     before redeeming; lets admin grep the printed list.
 *   - 8 random chars from a 32-char alphabet (uppercase + digits with
 *     ambiguous chars removed) → 32^8 ≈ 1.1 × 10^12 combinations.
 *     Brute-force exhaustion at our rate limit (10/IP/hour) would take
 *     ~12,000 years per single voucher; combined with anti-bruteforce
 *     in the redeem endpoint, brute force is non-viable.
 *
 * Excluded characters: O, 0, I, 1, L. These are ambiguous when read
 * off a phone screen or hand-typed from a printed card.
 */

import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars (removed O,0,I,1,L)
const RANDOM_LENGTH = 8;

export type VoucherTier = "100k" | "200k" | "500k";

interface TierConfig {
  vndValue: number;
  eurValue: number;
  /** Embedded in the code string: "100" | "200" | "500" */
  codeSegment: string;
}

export const TIER_CONFIG: Record<VoucherTier, TierConfig> = {
  "100k": { vndValue: 100_000, eurValue: 100, codeSegment: "100" },
  "200k": { vndValue: 200_000, eurValue: 200, codeSegment: "200" },
  "500k": { vndValue: 500_000, eurValue: 500, codeSegment: "500" },
};

/** Generate one voucher code for the given tier. */
export function generateVoucherCode(tier: VoucherTier): string {
  const { codeSegment } = TIER_CONFIG[tier];
  let random = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    // randomInt is CSPRNG (Node crypto). Math.random would be guessable.
    random += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return `CODE-${codeSegment}-${random}`;
}

/**
 * Normalise customer input before lookup. Customer might paste with
 * trailing whitespace, lowercase, or with curly quotes around it.
 * We don't accept `_` as separator — only `-`.
 */
export function normalizeVoucherCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s"'""]/g, "");
}

/**
 * Validate the SHAPE of a normalized voucher code. Used as a cheap
 * pre-check before hitting the DB so brute-force attempts that don't
 * even match the format don't consume rate-limit budget.
 *
 * Returns the tier if valid, null otherwise.
 */
export function parseVoucherCode(code: string): VoucherTier | null {
  const match = /^CODE-(100|200|500)-([A-Z2-9]{8})$/.exec(code);
  if (!match) return null;
  const seg = match[1];
  switch (seg) {
    case "100":
      return "100k";
    case "200":
      return "200k";
    case "500":
      return "500k";
    default:
      return null;
  }
}

/** Mask the random portion when logging. Keep prefix visible. */
export function maskVoucherCode(code: string): string {
  // CODE-100-X4K9MPQR → CODE-100-***MPQR
  const m = /^(CODE-\d{3}-)([A-Z2-9]{2})([A-Z2-9]{2})([A-Z2-9]{4})$/.exec(code);
  if (!m) return "***";
  return `${m[1]}***${m[4]}`;
}
