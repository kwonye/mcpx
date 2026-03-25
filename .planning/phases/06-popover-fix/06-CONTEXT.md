# Phase 6: Popover Fix - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix menu bar popover so content is scrollable and buttons are organized without duplicates. This phase fixes the `-webkit-app-region: drag` blocking scroll events and reorganizes the popover action buttons.

</domain>

<decisions>
## Implementation Decisions

### Scroll Fix
- **D-01:** Remove `-webkit-app-region: drag` from `.popover` CSS class entirely
- **D-02:** The popover window is small and doesn't need repositioning — users can click the tray icon near their desired position

### Button Organization
- **D-03:** Remove all header icon buttons (settings and power icons)
- **D-04:** Keep footer section with two buttons:
  - "Open Dashboard" button (primary styling)
  - Daemon toggle button (secondary styling) — shows "Start Daemon" or "Stop Daemon" based on current daemon state
- **D-05:** Remove "Sync All Clients" button from popover — sync is available in the full dashboard

### Code Changes Required
- `app/src/renderer/index.css`: Remove `-webkit-app-region: drag` from `.popover` class
- `app/src/renderer/components/StatusPopover.tsx`:
  - Remove settings and power icon buttons from header
  - Replace "Sync All Clients" button with daemon toggle button
  - Use existing `handleDaemonToggle` function for the toggle button

</decisions>

<specifics>
## Specific Ideas

- User preference: Simpler UI — remove unnecessary buttons and complexity
- User preference: Toggle button that adapts to current state is cleaner than separate Start/Stop buttons

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — POPOVER-01 (scroll when overflow), POPOVER-02 (no duplicate buttons)

### Code Files
- `app/src/renderer/components/StatusPopover.tsx` — Popover UI component
- `app/src/renderer/index.css` — Popover styling (lines 416-509)
- `app/src/main/popover.ts` — Popover window management

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Structure
- `.popover` CSS class has `-webkit-app-region: drag` (line 423) which blocks scroll events
- Header has settings icon (line 49) and power icon (line 52) — both open dashboard or toggle daemon
- Footer has "Open Dashboard" (line 100) and "Sync All Clients" (line 104) buttons
- `handleDaemonToggle()` function already exists (line 30) — can be reused for toggle button

### Integration Points
- `window.mcpx.openDashboard()` — opens dashboard window
- `window.mcpx.daemonStart()` / `window.mcpx.daemonStop()` — daemon lifecycle
- `report.daemon.running` — boolean state for toggle button text

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-popover-fix*
*Context gathered: 2026-03-25*