import { describe, expect, it } from "vitest";
import { rawRows } from "./raw-rows";

describe("rawRows", () => {
  it("returns postgres-js raw result arrays directly", () => {
    const rows = [{ id: "a" }, { id: "b" }];

    expect(rawRows<{ id: string }>(rows)).toBe(rows);
  });

  it("unwraps Neon-style { rows } results", () => {
    const rows = [{ id: "a" }];

    expect(rawRows<{ id: string }>({ rows })).toBe(rows);
  });

  it("returns an empty array for unexpected shapes", () => {
    expect(rawRows(null)).toEqual([]);
    expect(rawRows({ rows: null })).toEqual([]);
  });
});
