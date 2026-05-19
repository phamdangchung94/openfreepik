import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pricing lookup tests — split into two suites:
 *
 *   1. `lookupFor*` wrappers: pure functions, no DB. Verify each
 *      endpoint's params → PricingLookup mapping (default duration,
 *      tier choice, audio flag, resolution-as-tier hack for WAN).
 *
 *   2. `calculateCost`: hits drizzle; we mock the DB module so the
 *      test stays a unit test (no Neon connection required). Covers
 *      happy path + the throw-on-not-found error path.
 *
 * Why this matters: pricing is revenue-critical. A regression that
 * silently routes 4K requests to the 1080p rate would over-charge
 * customers 5×; the reverse would under-bill us with no recovery
 * path. These tests are the canary.
 */

// Mock the db client BEFORE importing the module under test. Vitest
// hoists vi.mock() calls but the mock factory still needs the chain
// shape `select().from().where().limit()` to mirror the real Drizzle
// query builder so the calculator code can call through unchanged.
vi.mock("@/lib/db/client", () => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select },
    // Test helpers re-exported so each test can rewire `limit`'s
    // return value on a per-case basis.
    __mocks: { select, from, where, limit },
  };
});

// Re-import the mock helpers — they're attached to the same module
// instance the calculator imports.
import * as dbModule from "@/lib/db/client";
const dbMocks = (dbModule as unknown as {
  __mocks: { limit: ReturnType<typeof vi.fn> };
}).__mocks;

import {
  calculateCost,
  lookupForKlingV3,
  lookupForKling4k,
  lookupForImprovePrompt,
  lookupForWanV27,
  lookupForKlingMotion,
  PricingNotFoundError,
} from "./calculator";

describe("lookupForKlingV3", () => {
  it("defaults duration to 5s when omitted", () => {
    const l = lookupForKlingV3({}, "std");
    expect(l.durationSeconds).toBe(5);
  });

  it("parses string duration to number", () => {
    const l = lookupForKlingV3({ duration: "10" }, "pro");
    expect(l.durationSeconds).toBe(10);
  });

  it("passes through tier choice", () => {
    expect(lookupForKlingV3({}, "std").tier).toBe("std");
    expect(lookupForKlingV3({}, "pro").tier).toBe("pro");
  });

  it("defaults audio to false; truthy generate_audio flips it", () => {
    expect(lookupForKlingV3({}, "std").withAudio).toBe(false);
    expect(lookupForKlingV3({ generate_audio: true }, "std").withAudio).toBe(
      true,
    );
  });

  it("always uses the kling-v3 endpoint", () => {
    expect(lookupForKlingV3({ duration: "5" }, "std").endpoint).toBe(
      "kling-v3",
    );
  });
});

describe("lookupForKling4k", () => {
  it("routes T2V endpoint to its own pricing row", () => {
    const l = lookupForKling4k("kling-4k-t2v", {});
    expect(l.endpoint).toBe("kling-4k-t2v");
    expect(l.tier).toBe("4k");
  });

  it("routes I2V endpoint to its own pricing row", () => {
    const l = lookupForKling4k("kling-4k-i2v", {});
    expect(l.endpoint).toBe("kling-4k-i2v");
    expect(l.tier).toBe("4k");
  });

  it("accepts duration as number OR string", () => {
    expect(lookupForKling4k("kling-4k-t2v", { duration: 8 }).durationSeconds).toBe(8);
    expect(lookupForKling4k("kling-4k-t2v", { duration: "8" }).durationSeconds).toBe(8);
  });

  it("defaults duration to 5s", () => {
    expect(lookupForKling4k("kling-4k-t2v", {}).durationSeconds).toBe(5);
  });

  it("carries the generate_audio flag through (4K bills same either way)", () => {
    expect(lookupForKling4k("kling-4k-t2v", { generate_audio: false }).withAudio).toBe(false);
    expect(lookupForKling4k("kling-4k-t2v", { generate_audio: true }).withAudio).toBe(true);
  });
});

describe("lookupForImprovePrompt", () => {
  it("returns the free-endpoint sentinel (null tier, null duration)", () => {
    const l = lookupForImprovePrompt();
    expect(l.endpoint).toBe("improve-prompt");
    expect(l.tier).toBeNull();
    expect(l.durationSeconds).toBeNull();
    expect(l.withAudio).toBe(false);
  });
});

describe("lookupForWanV27", () => {
  it("maps 1080P to pro tier (default)", () => {
    expect(lookupForWanV27({ resolution: "1080P" }).tier).toBe("pro");
  });

  it("maps 720P to std tier", () => {
    expect(lookupForWanV27({ resolution: "720P" }).tier).toBe("std");
  });

  it("defaults to pro tier when resolution omitted", () => {
    expect(lookupForWanV27({}).tier).toBe("pro");
  });

  it("never bills WAN with audio (not a price modifier)", () => {
    expect(
      lookupForWanV27({ resolution: "1080P" }).withAudio,
    ).toBe(false);
  });

  it("defaults duration to 5s", () => {
    expect(lookupForWanV27({}).durationSeconds).toBe(5);
  });
});

describe("lookupForKlingMotion", () => {
  it("encodes both version and tier into the endpoint string", () => {
    expect(lookupForKlingMotion("v2-6", "std", 5).endpoint).toBe(
      "kling-motion-v2-6-std",
    );
    expect(lookupForKlingMotion("v2-6", "pro", 5).endpoint).toBe(
      "kling-motion-v2-6-pro",
    );
    expect(lookupForKlingMotion("v3", "std", 5).endpoint).toBe(
      "kling-motion-v3-std",
    );
    expect(lookupForKlingMotion("v3", "pro", 5).endpoint).toBe(
      "kling-motion-v3-pro",
    );
  });

  it("leaves tier null (endpoint string already carries the discriminant)", () => {
    expect(lookupForKlingMotion("v3", "pro", 10).tier).toBeNull();
    expect(lookupForKlingMotion("v2-6", "std", 30).tier).toBeNull();
  });

  it("passes durationSeconds through verbatim", () => {
    expect(lookupForKlingMotion("v3", "pro", 5).durationSeconds).toBe(5);
    expect(lookupForKlingMotion("v3", "pro", 10).durationSeconds).toBe(10);
    expect(lookupForKlingMotion("v3", "pro", 15).durationSeconds).toBe(15);
    expect(lookupForKlingMotion("v3", "pro", 30).durationSeconds).toBe(30);
  });

  it("never bills motion with audio (not a price modifier)", () => {
    expect(lookupForKlingMotion("v3", "pro", 5).withAudio).toBe(false);
    expect(lookupForKlingMotion("v2-6", "std", 30).withAudio).toBe(false);
  });
});

describe("calculateCost", () => {
  beforeEach(() => {
    dbMocks.limit.mockReset();
  });

  it("returns the EUR cost from the matching pricing_rules row", async () => {
    dbMocks.limit.mockResolvedValueOnce([{ costEur: "0.84" }]);
    const cost = await calculateCost({
      endpoint: "kling-v3",
      tier: "std",
      durationSeconds: 5,
      withAudio: false,
    });
    expect(cost).toBe(0.84);
  });

  it("coerces numeric strings to Number", async () => {
    dbMocks.limit.mockResolvedValueOnce([{ costEur: "1.12" }]);
    const cost = await calculateCost({
      endpoint: "kling-4k-t2v",
      tier: "4k",
      durationSeconds: 1,
      withAudio: false,
    });
    expect(typeof cost).toBe("number");
    expect(cost).toBe(1.12);
  });

  it("throws PricingNotFoundError when no rule matches", async () => {
    dbMocks.limit.mockResolvedValueOnce([]);
    const lookup = {
      endpoint: "kling-v3",
      tier: "pro" as const,
      durationSeconds: 99,
      withAudio: true,
    };
    await expect(calculateCost(lookup)).rejects.toThrow(
      PricingNotFoundError,
    );
  });

  it("includes the lookup details in the not-found error", async () => {
    dbMocks.limit.mockResolvedValueOnce([]);
    const lookup = {
      endpoint: "wan-v27",
      tier: "std" as const,
      durationSeconds: 7,
      withAudio: false,
    };
    try {
      await calculateCost(lookup);
      // unreachable
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PricingNotFoundError);
      const e = err as PricingNotFoundError;
      expect(e.lookup).toEqual(lookup);
      expect(e.message).toContain("wan-v27");
      expect(e.message).toContain("std");
      expect(e.message).toContain("7s");
    }
  });

  it("handles null-tier (improve-prompt) lookups", async () => {
    dbMocks.limit.mockResolvedValueOnce([{ costEur: "0.00" }]);
    const cost = await calculateCost({
      endpoint: "improve-prompt",
      tier: null,
      durationSeconds: null,
      withAudio: false,
    });
    expect(cost).toBe(0);
  });
});
