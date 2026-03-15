---
phase: 03-tray-icon
research_completed: 2026-03-12
confidence: HIGH
---

# Phase 3: Tray Icon - Research Summary

**Goal:** Menu bar icon integrates seamlessly with macOS light/dark modes

**Requirements:** ICON-01, ICON-02, ICON-03, ICON-04

## Current State Analysis

### Existing Implementation

**File:** `app/src/main/tray.ts`
- Module-level `let tray: Tray | null = null;` at line 5 ✓
- Uses `nativeImage.createFromPath()` for icon loading
- Template naming convention used

**Files:** `app/resources/`
- `trayIconTemplate.png` - 16x16 PNG (98 bytes)
- `trayIconTemplate@2x.png` - 32x32 PNG (138 bytes)

### Already Satisfied

| Requirement | Current | Status |
|-------------|---------|--------|
| ICON-02 (template format) | `*Template.png` naming | ✓ Satisfied |
| ICON-03 (16x16 + 32x32@2x) | Both sizes exist | ✓ Satisfied |
| ICON-04 (module-level ref) | `let tray: Tray \| null = null` | ✓ Satisfied |

### Gap

| Requirement | Current | Gap |
|-------------|---------|-----|
| ICON-01 (proper design) | Unknown quality | Need to verify icon is acceptable |

## Analysis

The icon files are very small (98 and 138 bytes), suggesting simple placeholder icons. Need to:
1. Verify current icon design is acceptable
2. If not, design a proper MCP-themed icon

## macOS Template Icon Requirements

1. **Naming:** Must end with `Template` (case-sensitive)
2. **Colors:** Black with alpha channel only (macOS auto-inverts for dark mode)
3. **Sizes:** 16x16 (1x) and 32x32 (2x) for standard/Retina
4. **Style:** Simple, recognizable at small sizes

## Recommended Icon Design

For an MCP server manager, consider:
- Server/rack icon
- Network/node icon
- Simple "M" letterform
- Terminal/console icon

## Minimal Changes Needed

Since 3 of 4 requirements are already satisfied, this phase may only need:
1. Icon design verification
2. Potentially create better icon assets
3. E2E test to verify dark mode adaptation

---

*Research completed: 2026-03-12*
*Ready for planning: yes*