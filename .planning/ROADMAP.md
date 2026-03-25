# Roadmap: mcpx Desktop App

## Overview

This roadmap tracks mcpx desktop app development from v1.0 MVP through v1.1 UI Fixes. The v1.0 milestone delivered a functional app with launch stability, fuzzy search, tray icon, and macOS UI polish. The v1.1 milestone addresses critical UI bugs discovered post-release: broken popover scrolling, non-draggable window, inconsistent padding, broken search results, and more.

## Milestones

- **v1.0 MVP** - Phases 1-4 (shipped 2026-03-12)
- **v1.1 UI Fixes** - Phases 5-9 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 MVP (Phases 1-4) - SHIPPED 2026-03-12</summary>

### Phase 1: Launch Stability
**Goal**: App launches successfully and renders content reliably on every attempt
**Depends on**: Nothing (foundation phase)
**Requirements**: LAUNCH-01, LAUNCH-02, LAUNCH-03
**Success Criteria** (what must be TRUE):
  1. App launches 10/10 times without crashing on startup
  2. Main window renders full UI content (not blank/white screen)
  3. App respects macOS lifecycle (doesn't quit when window closes, responds to reopen)
**Plans**: 5 plans (all complete)

Plans:
- [x] 01-launch-stability-00-PLAN.md — Research and validate Electron lifecycle patterns
- [x] 01-launch-stability-01-PLAN.md — Add crash diagnostics and 10-launch E2E test
- [x] 01-launch-stability-02-PLAN.md — Verify macOS lifecycle handlers and create lifecycle E2E tests
- [x] 01-launch-stability-03-PLAN.md — Create render verification and lifecycle unit tests
- [x] 01-launch-stability-04-PLAN.md — Fix lifecycle unit tests for ESM compatibility (gap closure)

### Phase 2: Fuzzy Search
**Goal**: Users can find MCP servers even with typos or partial matches
**Depends on**: Phase 1 (stable app to test search)
**Requirements**: SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04
**Success Criteria** (what must be TRUE):
  1. Typing "filesytem" matches "filesystem MCP" (typo tolerance)
  2. Search results ordered by match quality, not just filtered list
  3. Search input doesn't freeze UI while typing (debounced)
  4. Partial matches like "file" returns "File System" and "filesystem"
**Plans**: 3 plans (complete)

Plans:
- [x] 02-fuzzy-search-00-PLAN.md — Install Fuse.js and refactor search-utils
- [x] 02-fuzzy-search-01-PLAN.md — Add debounced search input
- [x] 02-fuzzy-search-02-PLAN.md — E2E tests for fuzzy search

### Phase 3: Tray Icon
**Goal**: Menu bar icon integrates seamlessly with macOS light/dark modes
**Depends on**: Phase 1 (stable app to show tray)
**Requirements**: ICON-01, ICON-02, ICON-03, ICON-04
**Success Criteria** (what must be TRUE):
  1. Tray icon visible in macOS menu bar after app launch
  2. Icon auto-inverts colors when switching between light/dark mode
  3. Icon remains crisp at both normal and Retina resolutions
  4. Tray icon persists (doesn't disappear after minutes of runtime)
**Plans**: 1 plan (complete)

### Phase 4: macOS UI Polish
**Goal**: App feels native to macOS with proper visual design
**Depends on**: Phase 1 (stable app to polish)
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. UI uses system fonts (-apple-system) and proper spacing (8px grid)
  2. Dark mode colors adapt correctly when macOS theme changes
  3. Window controls use hiddenInset title bar (native traffic light positioning)
  4. All components have consistent visual polish (no rough edges)
**Plans**: 1 plan (complete)

</details>

### v1.1 UI Fixes (In Progress)

**Milestone Goal:** Fix all broken UI components and interactions discovered after v1.0.

- [x] **Phase 5: Fuzzy Search Fix** - Search returns matching results
- [x] **Phase 6: Popover Fix** - Popover scrolls properly with no duplicate buttons
- [x] **Phase 7: Window Drag Fix** - Dashboard window is draggable from title bar
- [ ] **Phase 8: Layout Polish** - Consistent padding, organized layout, proper control placement
- [ ] **Phase 9: Search State Persistence** - Search state persists between window opens

#### Phase 5: Fuzzy Search Fix
**Goal**: Users can find servers by searching with relevant results returned
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: BROWSE-02
**Success Criteria** (what must be TRUE):
  1. User can type "vercel" and see Vercel-related servers in results
  2. User can type single-character queries and get matching results
  3. Search results display server name, description, and repository info
**Plans**: 1 plan

Plans:
- [x] 09-01-PLAN.md — Persist search query, category, and tab state between sessions

Plans:
- [x] 05-01-PLAN.md — Simplify search by removing redundant Fuse.js filtering, rely on API search

#### Phase 6: Popover Fix
**Goal**: Menu bar popover content is scrollable and has clean UI
**Depends on**: Phase 5
**Requirements**: POPOVER-01, POPOVER-02
**Success Criteria** (what must be TRUE):
  1. User can scroll popover content when there are many servers
  2. Popover header remains visible while scrolling content
  3. Each action button appears exactly once in the popover (no duplicates)
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — Persist search query, category, and tab state between sessions

Plans:
- [x] 06-01-PLAN.md — Remove scroll-blocking CSS and reorganize popover buttons

#### Phase 7: Window Drag Fix
**Goal**: Dashboard window can be dragged from the title bar area
**Depends on**: Phase 6
**Requirements**: WIND-01
**Success Criteria** (what must be TRUE):
  1. User can drag the dashboard window by clicking and holding the title bar area
  2. Window moves smoothly when dragged via trackpad or mouse
  3. Traffic light buttons (close/minimize/maximize) remain clickable and functional
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — Persist search query, category, and tab state between sessions

Plans:
- [x] 07-01-PLAN.md — Restructure sidebar HTML and CSS for window drag regions

#### Phase 8: Layout Polish
**Goal**: Dashboard and browse views have consistent, macOS-standard spacing and layout
**Depends on**: Phase 7
**Requirements**: WIND-02, SIDE-01, BROWSE-01, PASTE-01
**Success Criteria** (what must be TRUE):
  1. Dashboard uses consistent 16-20pt padding throughout (no uneven margins)
  2. Daemon start/stop controls appear at the top of the sidebar (hero position)
  3. Browse registry shows organized card layout with consistent spacing
  4. Paste command displays as multi-line text instead of one long horizontal line
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Move daemon controls to sidebar hero position, standardize padding
- [x] 08-02-PLAN.md — Change browse registry to grid layout, improve paste command display

#### Phase 9: Search State Persistence
**Goal**: Search state is preserved between dashboard window sessions
**Depends on**: Phase 8
**Requirements**: BROWSE-03
**Success Criteria** (what must be TRUE):
  1. Search query remains in the input field after closing and reopening dashboard
  2. User can resume searching without retyping the previous query
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — Persist search query, category, and tab state between sessions

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Launch Stability | v1.0 | 5/5 | Complete | 2026-03-12 |
| 2. Fuzzy Search | v1.0 | 3/3 | Complete | 2026-03-12 |
| 3. Tray Icon | v1.0 | 1/1 | Complete | 2026-03-12 |
| 4. macOS UI Polish | v1.0 | 1/1 | Complete | 2026-03-12 |
| 5. Fuzzy Search Fix | v1.1 | 1/1 | Complete | 2026-03-24 |
| 6. Popover Fix | v1.1 | 1/1 | Complete | 2026-03-25 |
| 7. Window Drag Fix | v1.1 | 1/1 | Complete | 2026-03-25 |
| 8. Layout Polish | v1.1 | 0/2 | Not started | - |
| 9. Search State Persistence | v1.1 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-09*
*v1.0 completed: 2026-03-12*
*v1.1 phases added: 2026-03-24*
*Phase 5 planned: 2026-03-24*
*Phase 6 planned: 2026-03-25*
*Phase 7 planned: 2026-03-25*
*Phase 8 planned: 2026-03-25*