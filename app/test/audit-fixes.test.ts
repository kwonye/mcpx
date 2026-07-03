import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("UI-01: Server card label fix", () => {
  it("uses 'Synced' instead of 'State' for sync count", () => {
    const serverCardPath = path.join(process.cwd(), "src/renderer/components/ServerCard.tsx");
    const source = fs.readFileSync(serverCardPath, "utf8");
    
    // Should use "Synced" label
    expect(source).toContain("Synced");
    
    // Should include "clients" unit
    expect(source).toContain("clients");
    
    // Should have tooltip with count
    expect(source).toMatch(/title.*Synced to.*client/);
  });
});

describe("UI-02: Spacing scale consistency", () => {
  it("uses CSS tokens instead of hardcoded values", () => {
    const cssPath = path.join(process.cwd(), "src/renderer/index.css");
    const source = fs.readFileSync(cssPath, "utf8");
    
    // Should use --panel-padding token
    expect(source).toContain("var(--panel-padding)");
    
    // Should use --space-2 token
    expect(source).toContain("var(--space-2)");
    
    // Should use --space-4 token
    expect(source).toContain("var(--space-4)");
  });
});

describe("UI-03: OAuth re-auth confirmation", () => {
  it("requires confirmation before starting OAuth", () => {
    const serverCardPath = path.join(process.cwd(), "src/renderer/components/ServerCard.tsx");
    const source = fs.readFileSync(serverCardPath, "utf8");
    
    // Should use window.confirm
    expect(source).toContain("window.confirm");
    
    // Should check confirmation result
    expect(source).toMatch(/if \(!confirmed\) return/);
  });

  it("visually distinguishes clickable badge", () => {
    const cssPath = path.join(process.cwd(), "src/renderer/index.css");
    const source = fs.readFileSync(cssPath, "utf8");
    
    // Should have font-weight for clickable badge
    expect(source).toMatch(/\.token-badge--clickable[\s\S]*?font-weight:\s*600/);
    
    // Should have border for clickable badge
    expect(source).toMatch(/\.token-badge--clickable[\s\S]*?border.*currentColor/);
  });
});
