import { describe, it, expect } from "vitest";
import { compareVersions } from "../src/core/update.js";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.3", "0.1.3")).toBe(0);
  });

  it("returns 1 when first version is greater", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });

  it("returns -1 when first version is less", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("handles versions with different segment counts", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0")).toBe(0);
  });

  it("handles major version differences", () => {
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });
});
