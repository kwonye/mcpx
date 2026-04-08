import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("application menu branding", () => {
  it("uses dynamic product naming for the app menu", async () => {
    const source = await readFile(join(__dirname, "../../src/main/menu.ts"), "utf-8");

    expect(source).toContain("getDesktopProductName()");
    expect(source).not.toContain('label: "mcpx"');
  });
});
