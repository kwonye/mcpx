import path from "node:path";
import { describe, expect, it } from "bun:test";
import { buildEnrichedPath } from "../src/core/spawn-env.js";

describe("buildEnrichedPath", () => {
  it("preserves existing entries and the platform delimiter", () => {
    const enriched = buildEnrichedPath(["alpha", "beta"].join(path.delimiter));
    expect(enriched.split(path.delimiter).slice(0, 2)).toEqual(["alpha", "beta"]);
    expect(enriched.includes(path.delimiter)).toBe(true);
  });
});
