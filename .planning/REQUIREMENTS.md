# Requirements: mcpx Desktop App v1.1 UI Fixes

**Defined:** 2026-03-24
**Core Value:** A reliable, polished desktop app that makes MCP server management effortless and intuitive.

## v1 Requirements

### Popover

- [ ] **POPOVER-01**: User can scroll popover content when it overflows
- [ ] **POPOVER-02**: Popover has no duplicate functionality buttons (e.g., "Open Dashboard")

### Window

- [ ] **WIND-01**: User can drag window from title bar area
- [ ] **WIND-02**: Dashboard padding and margins follow macOS conventions (16-20pt consistent spacing)

### Sidebar

- [ ] **SIDE-01**: User sees daemon start/stop controls at top of sidebar (hero area)

### Browse

- [ ] **BROWSE-01**: Browse registry layout is clean and organized
- [x] **BROWSE-02**: Fuzzy search returns matching results (e.g., searching "vercel" shows Vercel servers)
- [ ] **BROWSE-03**: Search state persists between window opens

### Paste Command

- [ ] **PASTE-01**: Paste command UI uses multi-line layout instead of one long line

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Search

- **SEARCH-05**: Search term highlighting in results
- **SEARCH-06**: Recent searches history
- **SEARCH-07**: Keyboard navigation of search results

### Advanced UI

- **UI-05**: Window vibrancy effects (sidebar/material)
- **UI-06**: Custom animations and transitions

## Out of Scope

| Feature | Reason |
|---------|--------|
| New MCP server features | Focus on fixing existing functionality |
| Windows/Linux support | macOS only |
| New features of any kind | Purely fixes and polish |
| Full-text search in descriptions | Defer to v2+ |
| Server-side category filtering | Defer to v2+ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| POPOVER-01 | Phase 6 | Pending |
| POPOVER-02 | Phase 6 | Pending |
| WIND-01 | Phase 7 | Pending |
| WIND-02 | Phase 8 | Pending |
| SIDE-01 | Phase 8 | Pending |
| BROWSE-01 | Phase 8 | Pending |
| BROWSE-02 | Phase 5 | Complete |
| BROWSE-03 | Phase 9 | Pending |
| PASTE-01 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-24*
*Traceability updated: 2026-03-24*