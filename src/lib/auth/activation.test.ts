import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Activation tests — covers validateCode, chargeCode, refundCode.
 *
 * These three functions are the financial gate: any regression that
 * lets an inactive code through, or charges twice, or fails to refund
 * a failed task either loses us money or pisses off a customer.
 *
 * Strategy: mock the `db` client to return canned rows; we don't test
 * the SQL itself (drizzle/postgres handle that). What we DO test:
 *   - validateCode branches: too-short / not-found / inactive / expired
 *     / active
 *   - chargeCode: rejects negative cost, free-endpoint shortcut for
 *     cost=0, returns metadata on success, returns null on race-lost
 *     update (zero rows returned)
 *   - refundCode: no-op for cost <= 0; calls the update otherwise
 */

vi.mock("@/lib/db/client", () => {
  // Both select-chain and update-chain need different mock instances
  // because chargeCode/refundCode use update but validateCode uses
  // select. They share the same mock object pattern.
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    db: { select, update },
    __mocks: {
      select,
      selectLimit,
      update,
      updateReturning,
      updateSet,
      updateWhere,
    },
  };
});

import * as dbModule from "@/lib/db/client";
const m = (
  dbModule as unknown as {
    __mocks: {
      selectLimit: ReturnType<typeof vi.fn>;
      updateReturning: ReturnType<typeof vi.fn>;
      updateSet: ReturnType<typeof vi.fn>;
    };
  }
).__mocks;

import { validateCode, chargeCode, refundCode } from "./activation";

// Helper for canned rows — matches the activationCodes row shape that
// validateCode sees after the select.
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "code-uuid-1",
    code: "FK-TESTCODE-1234-5678",
    customerLabel: "Test customer",
    mode: "quota" as const,
    quotaEur: "100.00",
    usedEur: "10.00",
    isActive: true,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    expiresAt: null,
    ...overrides,
  };
}

describe("validateCode", () => {
  beforeEach(() => {
    m.selectLimit.mockReset();
  });

  it("rejects too-short codes without hitting the DB", async () => {
    const result = await validateCode("short");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
    expect(m.selectLimit).not.toHaveBeenCalled();
  });

  it("rejects empty / null-equivalent codes", async () => {
    const result = await validateCode("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("returns not_found when DB returns no rows", async () => {
    m.selectLimit.mockResolvedValueOnce([]);
    const result = await validateCode("FK-NOSUCH-CODE-1234");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("returns inactive when is_active=false", async () => {
    m.selectLimit.mockResolvedValueOnce([row({ isActive: false })]);
    const result = await validateCode("FK-VALID-CODE-1234");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("inactive");
  });

  it("returns expired when expires_at is in the past", async () => {
    m.selectLimit.mockResolvedValueOnce([
      row({ expiresAt: new Date(Date.now() - 86_400_000) }),
    ]);
    const result = await validateCode("FK-VALID-CODE-1234");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("accepts ISO-string expires_at (neon-http driver returns strings)", async () => {
    m.selectLimit.mockResolvedValueOnce([
      row({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() }),
    ]);
    const result = await validateCode("FK-VALID-CODE-1234");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("returns ok + metadata for an active non-expired code", async () => {
    m.selectLimit.mockResolvedValueOnce([row()]);
    const result = await validateCode("FK-VALID-CODE-1234");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.codeId).toBe("code-uuid-1");
      expect(result.metadata.mode).toBe("quota");
      expect(result.metadata.quotaEur).toBe(100);
      expect(result.metadata.usedEur).toBe(10);
      expect(result.metadata.remainingEur).toBe(90);
    }
  });

  it("returns remainingEur=null for unlimited mode regardless of quota", async () => {
    m.selectLimit.mockResolvedValueOnce([
      row({ mode: "unlimited", quotaEur: "500.00", usedEur: "200.00" }),
    ]);
    const result = await validateCode("FK-VALID-CODE-1234");
    if (result.ok) expect(result.metadata.remainingEur).toBeNull();
  });

  it("treats null expires_at as no expiry", async () => {
    m.selectLimit.mockResolvedValueOnce([row({ expiresAt: null })]);
    const result = await validateCode("FK-VALID-CODE-1234");
    expect(result.ok).toBe(true);
  });
});

describe("chargeCode", () => {
  beforeEach(() => {
    m.selectLimit.mockReset();
    m.updateReturning.mockReset();
  });

  it("throws on negative cost", async () => {
    await expect(chargeCode("code-uuid-1", -0.01)).rejects.toThrow(
      "costEur must be >= 0",
    );
  });

  it("treats cost=0 as a select-only validation (no charge SQL)", async () => {
    m.selectLimit.mockResolvedValueOnce([row()]);
    const result = await chargeCode("code-uuid-1", 0);
    expect(result).not.toBeNull();
    expect(m.updateReturning).not.toHaveBeenCalled();
  });

  it("returns null when cost=0 and code is inactive", async () => {
    m.selectLimit.mockResolvedValueOnce([row({ isActive: false })]);
    const result = await chargeCode("code-uuid-1", 0);
    expect(result).toBeNull();
  });

  it("returns null when cost=0 and code does not exist", async () => {
    m.selectLimit.mockResolvedValueOnce([]);
    const result = await chargeCode("code-uuid-1", 0);
    expect(result).toBeNull();
  });

  it("returns metadata on successful charge", async () => {
    // Simulate DB returning the updated row (used_eur incremented by 5).
    m.updateReturning.mockResolvedValueOnce([
      row({ usedEur: "15.00" }),
    ]);
    const result = await chargeCode("code-uuid-1", 5);
    expect(result).not.toBeNull();
    expect(result?.usedEur).toBe(15);
    expect(result?.remainingEur).toBe(85);
  });

  it("returns null when WHERE filtered out the row (race-lost / insufficient balance)", async () => {
    // The atomic balance check failed — concurrent charge bled the
    // remaining EUR. Drizzle returns [] when no rows match.
    m.updateReturning.mockResolvedValueOnce([]);
    const result = await chargeCode("code-uuid-1", 100);
    expect(result).toBeNull();
  });

  it("rounds cost to 2 decimal places (Number(cost).toFixed(2) semantics)", async () => {
    // Just verify the function doesn't throw on non-round numbers
    // — the actual numeric precision is delegated to SQL.
    m.updateReturning.mockResolvedValueOnce([row({ usedEur: "10.16" })]);
    const result = await chargeCode("code-uuid-1", 0.158);
    expect(result?.usedEur).toBe(10.16);
  });
});

describe("refundCode", () => {
  beforeEach(() => {
    m.updateSet.mockReset();
  });

  it("is a no-op for cost <= 0 (no SQL fired)", async () => {
    await refundCode("code-uuid-1", 0);
    await refundCode("code-uuid-1", -0.5);
    expect(m.updateSet).not.toHaveBeenCalled();
  });

  it("fires UPDATE for positive cost", async () => {
    await refundCode("code-uuid-1", 1.25);
    expect(m.updateSet).toHaveBeenCalledTimes(1);
  });

  it("is fire-and-forget (no return value)", async () => {
    const result = await refundCode("code-uuid-1", 2);
    expect(result).toBeUndefined();
  });
});
