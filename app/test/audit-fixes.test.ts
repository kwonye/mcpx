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

// UI-03's "requires confirmation before starting OAuth" case used to assert
// on the literal string "window.confirm" in ServerCard.tsx's source. That
// confirmation now goes through the app's own ConfirmDialog component
// instead of the native (event-loop-blocking) window.confirm, so the source
// string no longer exists to match. Real behavioral coverage -- clicking the
// re-auth badge opens a confirm dialog, canceling it doesn't start OAuth,
// confirming it does -- now lives in test/components/ServerCard.test.tsx.
describe("UI-03: OAuth re-auth confirmation", () => {
  it("visually distinguishes clickable badge", () => {
    const cssPath = path.join(process.cwd(), "src/renderer/index.css");
    const source = fs.readFileSync(cssPath, "utf8");
    
    // Should have font-weight for clickable badge
    expect(source).toMatch(/\.token-badge--clickable[\s\S]*?font-weight:\s*600/);
    
    // Should have border for clickable badge
    expect(source).toMatch(/\.token-badge--clickable[\s\S]*?border.*currentColor/);
  });
});
