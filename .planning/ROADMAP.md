# mcpx Desktop App Fixes — Roadmap

**Created:** Mon Mar 09 2026
**Core Value:** A reliable, polished desktop app that makes MCP server management effortless and intuitive.

---

## Phases

- [ ] **Phase 1: Launch Stability** — App launches and renders reliably without crashes
- [ ] **Phase 2: Fuzzy Search** — Search handles typos and ranks results by relevance
- [ ] **Phase 3: Tray Icon** — Menu bar icon with macOS template format and dark mode support
- [ ] **Phase 4: macOS UI Polish** — Native macOS feel with proper spacing, fonts, and dark mode

---

## Phase Details

### Phase 1: Launch Stability

**Goal:** App launches successfully and renders content reliably on every attempt

**Depends on:** Nothing (foundation phase)

**Requirements:** LAUNCH-01, LAUNCH-02, LAUNCH-03

**Success Criteria** (what must be TRUE):
  1. App launches 10/10 times without crashing on startup
  2. Main window renders full UI content (not blank/white screen)
  3. App respects macOS lifecycle (doesn't quit when window closes, responds to reopen)

**Plans:** 5 plans

**Plans:**
- [x] 01-launch-stability-00-PLAN.md — Research and validate Electron lifecycle patterns
- [x] 01-launch-stability-01-PLAN.md — Add crash diagnostics and 10-launch E2E test
- [x] 01-launch-stability-02-PLAN.md — Verify macOS lifecycle handlers and create lifecycle E2E tests
- [x] 01-launch-stability-03-PLAN.md — Create render verification and lifecycle unit tests
- [ ] 01-launch-stability-04-PLAN.md — Fix lifecycle unit tests for ESM compatibility (gap closure)

---

### Phase 2: Fuzzy Search

**Goal:** Users can find MCP servers even with typos or partial matches

**Depends on:** Phase 1 (stable app to test search)

**Requirements:** SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04

**Success Criteria** (what must be TRUE):
  1. Typing "filesytem" matches "filesystem MCP" (typo tolerance)
  2. Search results ordered by match quality, not just filtered list
  3. Search input doesn't freeze UI while typing (debounced)
  4. Partial matches like "file" returns "File System" and "filesystem"

**Plans:** TBD

---

### Phase 3: Tray Icon

**Goal:** Menu bar icon integrates seamlessly with macOS light/dark modes

**Depends on:** Phase 1 (stable app to show tray)

**Requirements:** ICON-01, ICON-02, ICON-03, ICON-04

**Success Criteria** (what must be TRUE):
  1. Tray icon visible in macOS menu bar after app launch
  2. Icon auto-inverts colors when switching between light/dark mode
  3. Icon remains crisp at both normal and Retina resolutions
  4. Tray icon persists (doesn't disappear after minutes of runtime)

**Plans:** TBD

---

### Phase 4: macOS UI Polish

**Goal:** App feels native to macOS with proper visual design

**Depends on:** Phase 1 (stable app to polish)

**Requirements:** UI-01, UI-02, UI-03, UI-04

**Success Criteria** (what must be TRUE):
  1. UI uses system fonts (-apple-system) and proper spacing (8px grid)
  2. Dark mode colors adapt correctly when macOS theme changes
  3. Window controls use hiddenInset title bar (native traffic light positioning)
  4. All components have consistent visual polish (no rough edges)

**Plans:** TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Launch Stability | 2/4 | In Progress | - |
| 2. Fuzzy Search | 0/0 | Not started | - |
| 3. Tray Icon | 0/0 | Not started | - |
| 4. macOS UI Polish | 0/0 | Not started | - |

---

## Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAUNCH-01 | Phase 1 | Pending |
| LAUNCH-02 | Phase 1 | Pending |
| LAUNCH-03 | Phase 1 | Pending |
| SEARCH-01 | Phase 2 | Pending |
| SEARCH-02 | Phase 2 | Pending |
| SEARCH-03 | Phase 2 | Pending |
| SEARCH-04 | Phase 2 | Pending |
| ICON-01 | Phase 3 | Pending |
| ICON-02 | Phase 3 | Pending |
| ICON-03 | Phase 3 | Pending |
| ICON-04 | Phase 3 | Pending |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 4 | Pending |
| UI-03 | Phase 4 | Pending |
| UI-04 | Phase 4 | Pending |

**Coverage:** 15/15 requirements mapped ✓

---

*Roadmap created: Mon Mar 09 2026*
