import { describe, expect, it } from "vitest";
import { isDbMigrationMaintenanceMode } from "./maintenance";

describe("isDbMigrationMaintenanceMode", () => {
  it("enables the maintenance gate only for the explicit value 1", () => {
    expect(isDbMigrationMaintenanceMode("1")).toBe(true);
  });

  it.each([undefined, "", "0", "true", "yes", " 1 "])(
    "leaves the maintenance gate off for %s",
    (value) => {
      expect(isDbMigrationMaintenanceMode(value)).toBe(false);
    },
  );
});
