# Phase 7: Window Drag Fix - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the dashboard window draggable from the title bar area. Users should be able to click and drag from sidebar header or page headers to reposition the window, with traffic light buttons remaining fully functional.

</domain>

<decisions>
## Implementation Decisions

### Drag Region Placement
- **D-01:** Both sidebar header AND page headers are draggable regions
- **D-02:** Sidebar header (`.sidebar-logo` area with "mcpx Manager") has `-webkit-app-region: drag`
- **D-03:** Page headers (`.page-header` with titles) have `-webkit-app-region: drag`
- **D-04:** All interactive elements inside drag regions (buttons, links, inputs) need `-webkit-app-region: no-drag` to remain clickable

### Traffic Light Interaction
- **D-05:** Keep traffic light buttons at current position (16, 16) — no adjustment needed
- **D-06:** Sidebar header drag region must have `no-drag` around the traffic light area so buttons remain clickable

### Drag Area Visibility
- **D-07:** No visual feedback on hover — drag regions are invisible
- **D-08:** No cursor change (`cursor: grab` not applied) — users discover the behavior naturally

### CSS Changes Required
- `app/src/renderer/index.css`:
  - `.sidebar` class already has `-webkit-app-region: drag` (line 264)
  - `.page-header` already has `-webkit-app-region: drag` (line 352)
  - Ensure all interactive children have `-webkit-app-region: no-drag`
  - Verify traffic light area is not blocked

</decisions>

<specifics>
## Specific Ideas

- User preference: Standard macOS window behavior — drag from title bar area, invisible interaction
- User preference: Maximum drag area for convenience — both sidebar and page headers

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — WIND-01 (drag from title bar area)

### Code Files
- `app/src/main/dashboard.ts` — Dashboard window configuration (titleBarStyle, trafficLightPosition)
- `app/src/renderer/index.css` — Drag region CSS (lines 260-280 for sidebar, lines 349-358 for page-header)
- `app/src/renderer/components/Dashboard.tsx` — Dashboard layout structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Drag Region Setup
- `.sidebar` class has `-webkit-app-region: drag` (line 264)
- `.sidebar-inner` has `-webkit-app-region: no-drag` (line 276) — this BLOCKS the drag!
- `.page-header` has `-webkit-app-region: drag` (line 352)
- `.page-header > *` has `-webkit-app-region: no-drag` (line 357) — makes children interactive

### The Problem
- `.sidebar-inner` with `no-drag` is inside `.sidebar` with `drag` — this cancels the drag for the entire sidebar content
- Need to restructure: only the `.sidebar-logo` area should be drag, the rest interactive

### Traffic Light Position
- Positioned at (16, 16) from top-left
- Falls within the sidebar area
- Need to ensure the area around traffic lights is `no-drag` so buttons are clickable

### Integration Points
- `titleBarStyle: "hiddenInset"` in `dashboard.ts` — no visible title bar
- `trafficLightPosition: { x: 16, y: 16 }` — traffic lights at standard macOS position

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-window-drag-fix*
*Context gathered: 2026-03-25*