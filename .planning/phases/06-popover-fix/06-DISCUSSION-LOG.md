# Phase 6: Popover Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 06-popover-fix
**Areas discussed:** Scroll fix approach, Button organization

---

## Scroll Fix Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Remove drag entirely | Remove -webkit-app-region: drag. Popover is small, users can reposition by clicking tray icon. | ✓ |
| Selective drag regions | Keep drag on header only, set no-drag on main content. More complex. | |

**User's choice:** Remove drag entirely (recommended)
**Notes:** User prefers simpler solution — the popover doesn't need window dragging.

---

## Button Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Keep footer, remove header icon | Keep footer "Open Dashboard" + "Sync All". Remove header settings icon. | |
| Keep header icon, remove footer button | Keep header settings icon + Sync All button. Remove footer "Open Dashboard". | |
| Header-only (minimalist) | Keep header settings icon and add Sync icon next to it. Remove entire footer. | |

**User's choice:** Custom — Remove header icons, change footer functionality
**Notes:** User wants to remove all header icons (settings + power). Footer should have "Open Dashboard" + a daemon toggle button (replacing "Sync All Clients").

---

## Daemon Toggle Style

| Option | Description | Selected |
|--------|-------------|----------|
| Single toggle button | Shows "Start Daemon" or "Stop Daemon" based on state. Cleaner UI. | ✓ |
| Separate Start/Stop buttons | Two separate buttons always visible. More explicit. | |

**User's choice:** Single toggle button (recommended)
**Notes:** Toggle adapts to current daemon state — cleaner than showing both options.

---

## Claude's Discretion

None — user made all decisions.

## Deferred Ideas

None — discussion stayed within phase scope.