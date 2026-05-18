import { describe, it, expect, vi } from "vitest";

/**
 * Tests for the pure helpers extracted from orchestrator.ts. These are
 * smaller and less DB-coupled than the orchestrator core (which
 * orchestrates 5+ subsystems and is best tested via integration).
 *
 * Covered:
 *   - isKeyExhaustedError: only HTTP 402 / QUOTA_EXHAUSTED qualifies.
 *     The recent audit caught a regression where 401s also flipped
 *     keys inactive, draining the pool every Magnific hiccup.
 *   - reasonMessage: validation reason → customer-facing string.
 *   - fail: builds the standard !ok OrchestrateResult shape.
 *
 * Not covered here (need integration tests):
 *   - refundIfCharged (calls refundCode + db)
 *   - logUsage (db.insert)
 *   - finalizeUsageOnPoll (db.update + refundCode)
 * The activation.test.ts file covers refundCode itself.
 */

// We don't actually use the DB in these tests but the module imports
// it, so stub it to avoid Neon connection during test bootstrap.
vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("@/lib/auth/activation", () => ({
  refundCode: vi.fn(),
}));

import {
  isKeyExhaustedError,
  reasonMessage,
  fail,
} from "./orchestrator-helpers";
import { FreepikApiError } from "./errors";

describe("isKeyExhaustedError", () => {
  it("returns false for non-FreepikApiError values", () => {
    expect(isKeyExhaustedError(null)).toBe(false);
    expect(isKeyExhaustedError(undefined)).toBe(false);
    expect(isKeyExhaustedError(new Error("plain"))).toBe(false);
    expect(isKeyExhaustedError("string")).toBe(false);
    expect(isKeyExhaustedError({ code: "QUOTA_EXHAUSTED" })).toBe(false);
  });

  it("returns true for FreepikApiError with code=QUOTA_EXHAUSTED", () => {
    const err = new FreepikApiError({
      status: 402,
      code: "QUOTA_EXHAUSTED",
      message: "Out of credit",
    });
    expect(isKeyExhaustedError(err)).toBe(true);
  });

  it("returns false for other FreepikApiError codes (401, 429, 5xx)", () => {
    // The audit fix: 401 must NOT flip the key inactive, only retry
    // with another key for the current request.
    expect(
      isKeyExhaustedError(
        new FreepikApiError({ status: 401, code: "AUTH", message: "Unauthorized" }),
      ),
    ).toBe(false);
    expect(
      isKeyExhaustedError(
        new FreepikApiError({
          status: 429,
          code: "RATE_LIMIT",
          message: "Too many",
        }),
      ),
    ).toBe(false);
    expect(
      isKeyExhaustedError(
        new FreepikApiError({ status: 500, code: "SERVER", message: "Boom" }),
      ),
    ).toBe(false);
    expect(
      isKeyExhaustedError(
        new FreepikApiError({
          status: 400,
          code: "PLAN_LIMIT",
          message: "Plan does not allow",
        }),
      ),
    ).toBe(false);
  });
});

describe("reasonMessage", () => {
  it("maps each validation failure to a customer message", () => {
    expect(reasonMessage("not_found")).toBe("Activation code not found.");
    expect(reasonMessage("inactive")).toBe(
      "Activation code has been revoked.",
    );
    expect(reasonMessage("expired")).toBe("Activation code has expired.");
  });
});

describe("fail", () => {
  it("wraps status/error/message into the standard OrchestrateResult", () => {
    const r = fail(503, "ALL_KEYS_EXHAUSTED", "All upstream credits exhausted.");
    expect(r).toEqual({
      ok: false,
      status: 503,
      body: {
        error: "ALL_KEYS_EXHAUSTED",
        message: "All upstream credits exhausted.",
      },
    });
  });

  it("preserves any HTTP status code (4xx, 5xx)", () => {
    // narrow the union — fail() always returns !ok shape
    const r1 = fail(401, "AUTH", "Unauthorized");
    const r2 = fail(429, "RATE_LIMIT", "Too many");
    const r3 = fail(500, "UNKNOWN", "Something");
    if (r1.ok || r2.ok || r3.ok) throw new Error("unreachable");
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(429);
    expect(r3.status).toBe(500);
  });
});
