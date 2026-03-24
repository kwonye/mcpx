# Project Research Summary

**Project:** mcpx Desktop App v1.1 UI Fixes
**Domain:** Electron/macOS Desktop Application UI Fixes
**Researched:** 2026-03-24
**Confidence:** MEDIUM-HIGH

## Executive Summary

This research covers UI fixes for the mcpx desktop app v1.1 milestone: menu bar popover scrolling, dashboard window dragging, padding/margins, and browse/search behavior. The app uses Electron 35.x with React 19.1.x and vanilla CSS, following macOS conventions with `titleBarStyle: "hiddenInset"`.

The recommended approach focuses on three core technical patterns: (1) proper CSS flexbox scrolling with `min-height: 0` for flex children, (2) correct `-webkit-app-region` placement that separates draggable regions from interactive/scrollable content, and (3) Fuse.js configuration tuning for better fuzzy matching. The fixes are relatively isolated and can be implemented incrementally.

Key risks include the critical pitfall where `-webkit-app-region: drag` on scrollable containers blocks trackpad scroll events entirely, and the common mistake of placing drag regions in sidebars rather than across the window top for hiddenInset windows. Both require structural CSS changes rather than simple property additions.

## Key Findings

### Recommended Stack

No new dependencies required. All fixes use existing Electron APIs, CSS patterns, and Fuse.js configuration. The existing stack (Electron 35.x, React 19.1.x, TypeScript 5.9.3, Fuse.js 7.1.0, vanilla CSS) is validated and appropriate.

**Core patterns:**
- `-webkit-app-region: drag/no-drag` — Electron CSS property for window dragging in hiddenInset windows
- `min-height: 0` with `flex: 1` — Critical CSS pattern for enabling overflow scrolling in flex children
- Fuse.js threshold/minMatchCharLength — Configuration tuning for fuzzy search quality

### Expected Features

**Must have (table stakes) — P1:**
- POPOVER-01: Popover content scrolling — users expect smooth scroll when content overflows
- DRAG-01: Window drag from title area — standard macOS behavior, users instinctively drag from top
- DRAG-02: Consistent padding/margins — macOS apps use standard spacing (16px typical)
- BROWSE-02: Fuzzy search returns results — searching "vercel" should show Vercel-related servers

**Should have (competitive) — P2:**
- BROWSE-03: Search state persistence — remember query between window opens for seamless UX
- BROWSE-01: Browse registry layout polish — consistent card spacing and alignment

**Defer (v2+):**
- Full-text search in server descriptions
- Server-side category filtering
- Highlight matched terms in search results

### Architecture Approach

The fixes integrate primarily at the renderer layer (CSS and React components) with some main process changes for search. The layered architecture (Electron main -> Preload bridge -> React renderer) remains unchanged.

**Major integration points:**
1. `app/src/renderer/index.css` — CSS changes for popover scrolling, drag regions, padding
2. `app/src/renderer/components/StatusPopover.tsx` — JSX structure for popover layout
3. `app/src/renderer/components/Dashboard.tsx` — Possible structural changes for drag regions
4. `app/src/main/search-utils.ts` — Fuse.js configuration tuning
5. `app/src/main/registry-client.ts` — Type definitions, debug log removal

### Critical Pitfalls

1. **App-Region drag blocks scroll events** — Setting `-webkit-app-region: drag` on a container captures scroll wheel/trackpad events, preventing child scrolling even with `no-drag`. Structure DOM so scrollable containers are siblings of draggable regions, not descendants.

2. **Incorrect draggable region for hiddenInset** — With `titleBarStyle: "hiddenInset"`, drag regions must be at the TOP of the window, not in sidebars. Create a dedicated 32-52px tall drag strip spanning the full window width.

3. **Fuse.js minMatchCharLength blocks short queries** — Current `minMatchCharLength: 2` prevents single-character searches from returning results. Set to 1 or remove the setting entirely.

4. **React state doesn't persist across window closes** — Electron windows are full browser contexts; state is garbage collected when closed. Use localStorage or extend existing settings infrastructure for persistence.

5. **RegistryServerEntry type missing repository field** — Fuse.js searches `server.repository.url` but the type definition doesn't include this field, causing silent undefined matches.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Fuzzy Search Fix (BROWSE-02)
**Rationale:** Core functionality with no dependencies on other fixes; isolated to main process; high user impact.
**Delivers:** Working fuzzy search that returns relevant results for queries like "vercel".
**Addresses:** BROWSE-02 from FEATURES.md
**Avoids:** Fuse.js minMatchCharLength pitfall, missing type definition pitfall
**Changes:** Fuse.js config in search-utils.ts, type definitions in registry-client.ts, remove debug console.log

### Phase 2: Popover Scrolling Fix (POPOVER-01)
**Rationale:** Quick CSS fix, high visibility, isolated to popover component.
**Delivers:** Scrollable popover content with fixed header/footer.
**Addresses:** POPOVER-01 from FEATURES.md
**Avoids:** App-region drag blocks scroll pitfall
**Changes:** CSS in index.css, possibly JSX structure in StatusPopover.tsx

### Phase 3: Window Drag Fix (DRAG-01)
**Rationale:** Core UX issue; must be done before padding work (DRAG-02) since padding depends on final layout.
**Delivers:** Draggable window from title bar area; traffic lights work correctly.
**Addresses:** DRAG-01 from FEATURES.md
**Avoids:** Incorrect draggable region placement pitfall
**Changes:** CSS drag regions in index.css, possibly structural changes in Dashboard.tsx

### Phase 4: Padding and Layout Polish (DRAG-02, BROWSE-01)
**Rationale:** Polish work that depends on final layout from DRAG-01; combines related CSS fixes.
**Delivers:** Consistent macOS-standard padding throughout dashboard and browse views.
**Addresses:** DRAG-02, BROWSE-01 from FEATURES.md
**Avoids:** Sidebar padding in drag region pitfall
**Changes:** CSS padding values in index.css, extract inline styles from BrowseTab.tsx

### Phase 5: Search State Persistence (BROWSE-03)
**Rationale:** Nice-to-have enhancement; extends existing settings infrastructure; can be deferred if time-constrained.
**Delivers:** Search query remembered between dashboard window opens.
**Addresses:** BROWSE-03 from FEATURES.md
**Avoids:** React state not persisting pitfall
**Changes:** Extend settings-store.ts, desktop-settings.ts, BrowseTab.tsx

### Phase Ordering Rationale

- BROWSE-02 first: Core functionality, no dependencies, isolated changes
- POPOVER-01 second: Quick win, high visibility, isolated to popover
- DRAG-01 third: Core UX, must precede padding work
- DRAG-02/BROWSE-01 fourth: Polish, depends on drag region final layout
- BROWSE-03 last: Enhancement, can be deferred

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (BROWSE-02):** May need API response structure verification; test with real registry data
- **Phase 3 (DRAG-01):** Structural changes to Dashboard.tsx may require more detailed investigation

Phases with standard patterns (skip research-phase):
- **Phase 2 (POPOVER-01):** Well-documented CSS flexbox scrolling pattern
- **Phase 4 (DRAG-02, BROWSE-01):** Standard macOS spacing values, CSS extraction
- **Phase 5 (BROWSE-03):** Standard localStorage/settings persistence pattern

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Existing stack validated; no new dependencies needed; patterns well-documented |
| Features | MEDIUM | Based on codebase analysis and macOS conventions; web search APIs unavailable for external verification |
| Architecture | HIGH | Clear integration points documented; codebase analysis thorough |
| Pitfalls | HIGH | Critical pitfalls identified with specific code references; prevention strategies clear |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Fuse.js actual data verification:** The Fuse.js key paths (`server.name`, `server.title`, etc.) should be verified against actual registry API response structure during implementation.
- **Traffic light overlap testing:** The traffic light position `{ x: 16, y: 16 }` and sidebar drag region overlap needs visual verification on actual hardware.
- **Search behavior with real queries:** Test "vercel" and similar queries against the live registry to confirm Fuse.js tuning is correct.

## Sources

### Primary (HIGH confidence)
- Electron BrowserWindow API documentation — titleBarStyle, trafficLightPosition, app-region
- CSS Flexbox overflow patterns — MDN documentation for min-height: 0 flex scrolling
- Fuse.js API documentation — Configuration options and scoring
- Project codebase analysis — `.planning/codebase/ARCHITECTURE.md`, `app/src/renderer/index.css`

### Secondary (MEDIUM confidence)
- macOS Human Interface Guidelines — Standard spacing values (16pt, 52pt title bar height)
- Electron `-webkit-app-region` — Standard Electron pattern for drag regions

### Tertiary (LOW confidence)
- External search APIs were unavailable during research — some recommendations are based on established patterns rather than runtime verification

---
*Research completed: 2026-03-24*
*Ready for roadmap: yes*