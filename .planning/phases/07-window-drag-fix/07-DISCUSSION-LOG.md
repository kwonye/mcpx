# Phase 7: Window Drag Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 07-window-drag-fix
**Areas discussed:** Drag region placement, Traffic light interaction, Drag area visibility

---

## Drag Region Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar header only | Users drag from sidebar header only. Page headers stay interactive. | |
| Both sidebar and page headers | Users can drag from both sidebar header and page headers. More drag area. | ✓ |
| Dedicated top strip | Add an invisible 24-32px drag strip at the very top of the window, spanning the full width. | |

**User's choice:** Both sidebar and page headers
**Notes:** Maximum drag area for convenience.

---

## Traffic Light Interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Keep current position (Recommended) | Keep traffic lights where they are (16, 16). Sidebar header drag region avoids blocking them. | ✓ |
| Adjust position | Move traffic lights further right or down if they feel cramped. | |

**User's choice:** Keep current position
**Notes:** Standard macOS positioning is fine.

---

## Drag Area Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Invisible (no feedback) | No visual change on hover. Drag regions work invisibly. | ✓ |
| Grab cursor (Recommended) | Show `cursor: grab` on hover over drag regions. | |

**User's choice:** Invisible (no feedback)
**Notes:** Standard macOS behavior — users discover naturally.

---

## Claude's Discretion

None — user made explicit choices for all decisions.

## Deferred Ideas

None — discussion stayed within phase scope.