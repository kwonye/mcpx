# Phase 7: Window Drag Fix - Research

**Researched:** 2026-03-25
**Domain:** Electron frameless window drag regions, CSS webkit-app-region
**Confidence:** HIGH

## Summary

This phase fixes the dashboard window drag regions so users can reposition the window by dragging from the sidebar header or page headers. The current implementation has a structural issue where `.sidebar` has `drag` but `.sidebar-inner` has `no-drag`, which cancels the drag behavior for the entire sidebar content.

**Primary recommendation:** Move `-webkit-app-region: drag` from `.sidebar` to `.sidebar-logo`, and ensure the traffic light area (x: 16, y: 16) has appropriate `no-drag` handling for clickability.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Both sidebar header AND page headers are draggable regions
- **D-02:** Sidebar header (`.sidebar-logo` area with "mcpx Manager") has `-webkit-app-region: drag`
- **D-03:** Page headers (`.page-header` with titles) have `-webkit-app-region: drag`
- **D-04:** All interactive elements inside drag regions (buttons, links, inputs) need `-webkit-app-region: no-drag` to remain clickable
- **D-05:** Keep traffic light buttons at current position (16, 16) - no adjustment needed
- **D-06:** Sidebar header drag region must have `no-drag` around the traffic light area so buttons remain clickable
- **D-07:** No visual feedback on hover - drag regions are invisible
- **D-08:** No cursor change (`cursor: grab` not applied) - users discover the behavior naturally

### Claude's Discretion
None - all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIND-01 | User can drag window from title bar area | CSS `-webkit-app-region` property enables drag regions in Electron frameless windows |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron | 35.0.0 | Desktop app framework | Native cross-platform desktop apps with web technologies |
| React | 19.1.0 | UI framework | Component-based UI with state management |
| Vitest | 4.0.18 | Unit testing | Fast, Vite-native test runner |
| Playwright | 1.58.2 | E2E testing | Electron-compatible end-to-end testing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/react | 16.3.2 | Component testing | Testing React components in isolation |
| jsdom | 28.1.0 | DOM environment | Vitest test environment for DOM APIs |

## Architecture Patterns

### Current CSS Structure (Problem Identified)

```css
/* Line 258-267: .sidebar has drag */
.sidebar {
    -webkit-app-region: drag;  /* Makes entire sidebar a drag handle */
}

/* Line 269-277: .sidebar-inner has no-drag */
.sidebar-inner {
    -webkit-app-region: no-drag;  /* CANCELS drag for all sidebar content */
}

/* Line 345-354: .page-header has drag */
.page-header {
    -webkit-app-region: drag;  /* Page headers are draggable */
}

/* Line 356-358: .page-header children are interactive */
.page-header > * {
    -webkit-app-region: no-drag;  /* Children remain clickable */
}
```

**The Problem:** When a parent element has `-webkit-app-region: drag` and a child has `-webkit-app-region: no-drag`, the child element becomes interactive (clickable) but NOT draggable. Since `.sidebar-inner` fills the entire `.sidebar`, no part of the sidebar is actually draggable.

### Recommended CSS Changes

```css
/* .sidebar: REMOVE -webkit-app-region: drag */
.sidebar {
    width: 240px;
    flex-shrink: 0;
    padding: 16px;
    position: relative;
    z-index: 10;
    /* -webkit-app-region: drag; REMOVE THIS */
    display: flex;
    flex-direction: column;
}

/* .sidebar-inner: Keep no-drag for interactive content */
.sidebar-inner {
    /* Keep existing styles including -webkit-app-region: no-drag */
}

/* .sidebar-logo: ADD -webkit-app-region: drag */
.sidebar-logo {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    margin-bottom: 24px;
    -webkit-app-region: drag;  /* ADD THIS - makes logo area draggable */
}

/* Optional: Add no-drag cutout for traffic lights */
.sidebar-logo::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 60px;  /* Traffic light area width */
    height: 40px; /* Traffic light area height */
    -webkit-app-region: no-drag;  /* Makes traffic lights clickable */
}
```

### Traffic Light Positioning

From `app/src/main/dashboard.ts`:
```typescript
{
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 }
}
```

Traffic lights are positioned at (16px, 16px) from top-left. The traffic light cluster occupies approximately:
- X: 16px to ~70px (3 buttons at ~12px each with spacing)
- Y: 16px to ~36px (buttons are ~20px tall)

### HTML Structure (from Dashboard.tsx)

```tsx
<aside className="sidebar">
  <div className="sidebar-inner glass-panel">
    <div className="sidebar-logo">
      <div className="sidebar-logo-icon">...</div>
      <span className="sidebar-logo-text">mcpx Manager</span>
    </div>
    {/* Navigation buttons - should remain interactive */}
    <button className="nav-button">...</button>
  </div>
</aside>
```

### Anti-Patterns to Avoid

- **Don't apply `drag` to a container that wraps interactive elements:** Child elements with `no-drag` cancel the drag for their area, which can result in no draggable space.
- **Don't use `cursor: grab` on invisible drag regions:** Creates false affordances when there's no visual feedback.
- **Don't forget traffic lights:** With `hiddenInset` titleBarStyle, traffic lights overlay on content and need `no-drag` space to remain clickable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Window dragging | Custom mouse event handlers | `-webkit-app-region: drag` | Native macOS behavior, handles edge cases |
| Traffic light clickability | Custom hit testing | `-webkit-app-region: no-drag` | Works with Electron's native handling |

## Common Pitfalls

### Pitfall 1: Nested Drag/No-Drag Cancels Draggable Area
**What goes wrong:** Parent has `drag`, child has `no-drag`, and the child fills the parent - result: no draggable space.
**Why it happens:** `-webkit-app-region: no-drag` on a child element removes the drag behavior for that element's entire bounding box.
**How to avoid:** Apply `drag` to specific elements that should be draggable, not to containers that wrap interactive content.
**Warning signs:** Window won't move when clicking in expected drag areas.

### Pitfall 2: Traffic Lights Not Clickable
**What goes wrong:** Traffic light buttons (close, minimize, maximize) don't respond to clicks.
**Why it happens:** The drag region overlays the traffic light area without a `no-drag` cutout.
**How to avoid:** Ensure the area around traffic lights has `-webkit-app-region: no-drag` or is outside the drag region entirely.
**Warning signs:** Users report they cannot close/minimize the window.

### Pitfall 3: Interactive Elements Not Clickable Inside Drag Regions
**What goes wrong:** Buttons, links, or inputs inside a drag region don't respond to clicks.
**Why it happens:** The drag region captures mouse events for window movement.
**How to avoid:** Apply `-webkit-app-region: no-drag` to all interactive elements inside drag regions.
**Warning signs:** Navigation buttons or other controls stop working.

## Code Examples

### Correct Drag Region Pattern (from Electron docs pattern)

```css
/* Title bar area - draggable */
.title-bar {
    -webkit-app-region: drag;
    height: 32px;
}

/* Interactive elements inside title bar */
.title-bar button {
    -webkit-app-region: no-drag;
}

/* Content area - not draggable */
.content {
    /* No -webkit-app-region needed - defaults to no-drag */
}
```

### Traffic Light No-Drag Pattern

```css
/* Draggable header */
.header {
    -webkit-app-region: drag;
    position: relative;
}

/* Traffic light cutout */
.header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 70px;
    height: 40px;
    -webkit-app-region: no-drag;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom mouse event handlers for dragging | CSS `-webkit-app-region` | Electron 0.x | Native OS behavior, simpler code |

**Deprecated/outdated:**
- Using `app-region` without `-webkit-` prefix: Use `-webkit-app-region` for Electron compatibility.

## Open Questions

1. **Traffic light no-drag implementation:**
   - What we know: Traffic lights are at (16, 16), `.sidebar-logo` starts at approximately 16px from top due to `.sidebar` padding.
   - What's unclear: Whether `.sidebar-logo` needs an explicit `::before` pseudo-element for the no-drag cutout, or if the natural gap between sidebar edge and logo content is sufficient.
   - Recommendation: Test with `.sidebar-logo` having `drag` first. If traffic lights are not clickable, add `::before` pseudo-element with `no-drag`.

## Environment Availability

> SKIPPED (no external dependencies identified)

This phase involves only CSS modifications with no external tool, service, or runtime dependencies beyond the existing Electron app.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `app/vitest.config.ts` |
| Quick run command | `cd app && npm test` |
| Full suite command | `cd app && npm test && npm run e2e` |

### Phase Requirements -> Test Map
| ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIND-01 | Window can be dragged from title bar area | E2E (manual verification recommended) | `npm run e2e` | Partial - e2e/ui.spec.ts tests window creation |

### Sampling Rate
- Per task commit: `cd app && npm test`
- Per wave merge: `cd app && npm test && npm run e2e`
- Phase gate: Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `app/e2e/drag-regions.spec.ts` - E2E test for window drag behavior (manual verification also acceptable since drag regions are hard to automate)
- [x] `app/test/components/Dashboard.test.tsx` - Existing component tests cover rendering
- [x] Framework config: `app/vitest.config.ts` - Vitest configured

**Note:** Automated testing of drag regions in Electron is challenging. The primary validation should be manual testing:
1. Build and install: `cd app && npm run desktop-install`
2. Verify: Click and drag from sidebar header area - window should move
3. Verify: Click and drag from page header area - window should move
4. Verify: Traffic light buttons (close, minimize, maximize) remain clickable

## Sources

### Primary (HIGH confidence)
- Electron source code and documentation: `-webkit-app-region` CSS property for frameless windows
- Project source code: `app/src/renderer/index.css`, `app/src/main/dashboard.ts`, `app/src/renderer/components/Dashboard.tsx`

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions from user discussion session

### Tertiary (LOW confidence)
- None required - this is a well-understood CSS property within Electron

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Direct inspection of package.json and existing code
- Architecture: HIGH - Clear understanding of `-webkit-app-region` behavior from Electron docs and code analysis
- Pitfalls: HIGH - Common Electron frameless window issues, well-documented

**Research date:** 2026-03-25
**Valid until:** Stable - CSS drag regions are a mature Electron feature