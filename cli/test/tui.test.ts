import { describe, expect, it } from "bun:test";
import { renderManagementTuiFrame } from "../src/core/tui.js";

function visibleLines(rendered: string): string[] {
  return rendered
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n");
}

describe("management TUI rendering", () => {
  it("fits a stacked list and details layout in a 60x20 terminal", () => {
    const rendered = renderManagementTuiFrame({
      width: 60,
      height: 20,
      revision: 7,
      view: 1,
      summary: "4 MCPs · 2 skills · 3 harnesses",
      rows: Array.from({ length: 12 }, (_, i) => ({ title: `Harness ${i + 1}`, state: "selected", detail: "" })),
      selection: 0,
      details: ["global · Detected", "/Users/will/.config/mcpx/config.json", "mcp · skills", "Reload the harness configuration"],
      status: "All integrations, one place."
    });
    const lines = visibleLines(rendered);

    expect(lines).toHaveLength(20);
    expect(lines.every(line => line.length <= 60)).toBe(true);
    expect(rendered).not.toContain("│");
    expect(rendered).toContain("Reload the harness configuration");
  });

  it("keeps the split layout in a 100x30 terminal", () => {
    const rendered = renderManagementTuiFrame({
      width: 100,
      height: 30,
      revision: 7,
      view: 1,
      summary: "4 MCPs · 2 skills · 3 harnesses",
      rows: Array.from({ length: 12 }, (_, i) => ({ title: `Harness ${i + 1}`, state: "selected", detail: "" })),
      selection: 0,
      details: ["global · Detected", "/Users/will/.config/mcpx/config.json", "mcp · skills", "Reload the harness configuration"],
      status: "All integrations, one place."
    });
    const lines = visibleLines(rendered);

    expect(lines).toHaveLength(30);
    expect(lines.every(line => line.length <= 100)).toBe(true);
    expect(rendered).toContain("│");
    expect(rendered).toContain("1 Overview");
  });

  it("keeps a selected row visible after scrolling in the split layout", () => {
    const rendered = renderManagementTuiFrame({
      width: 100,
      height: 20,
      revision: 7,
      view: 1,
      summary: "30 harnesses",
      rows: Array.from({ length: 30 }, (_, i) => ({ title: `Harness ${i + 1}`, state: "selected", detail: "" })),
      selection: 25,
      details: ["global · Detected"],
      status: "All integrations, one place."
    });

    expect(rendered).toContain("\x1b[7m  Harness 26");
  });

  it("shows only the active view label below 35 columns", () => {
    const rendered = renderManagementTuiFrame({
      width: 30,
      height: 12,
      revision: 7,
      view: 1,
      summary: "30 harnesses",
      rows: [],
      selection: 0,
      details: ["No harnesses detected"],
      status: "Ready"
    });
    const lines = visibleLines(rendered);

    expect(lines).toHaveLength(12);
    expect(lines.every(line => line.length <= 30)).toBe(true);
    expect(rendered).toContain("2 Harnesses");
  });
});
