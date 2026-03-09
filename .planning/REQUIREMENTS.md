# Requirements: mcpx Desktop App Fixes

**Defined:** Mon Mar 09 2026
**Core Value:** A reliable, polished desktop app that makes MCP server management effortless and intuitive.

## v1 Requirements

### Launch Stability

- [ ] **LAUNCH-01**: App launches successfully without crashing on startup
- [ ] **LAUNCH-02**: App window renders content correctly after launch
- [ ] **LAUNCH-03**: App handles macOS lifecycle events (window-all-closed prevents quit)

### Search

- [ ] **SEARCH-01**: Search returns partial/fuzzy matches (not exact match only)
- [ ] **SEARCH-02**: Search results ranked by priority/popularity
- [ ] **SEARCH-03**: Search input debounced to prevent UI freezing
- [ ] **SEARCH-04**: Search supports typo tolerance

### Tray Icon

- [ ] **ICON-01**: New menu bar tray icon designed and implemented
- [ ] **ICON-02**: Tray icon uses macOS template format (auto-inverts for dark mode)
- [ ] **ICON-03**: Tray icon provided at 16x16 and 32x32@2x resolutions
- [ ] **ICON-04**: Tray reference held at module level (prevents garbage collection)

### UI Polish

- [ ] **UI-01**: UI follows macOS Human Interface Guidelines
- [ ] **UI-02**: Visual polish applied to all components (spacing, fonts, colors)
- [ ] **UI-03**: Dark mode support verified
- [ ] **UI-04**: Window uses hiddenInset title bar for native macOS controls

## v2 Requirements

### Enhanced Search

- **SEARCH-05**: Search term highlighting in results
- **SEARCH-06**: Recent searches history
- **SEARCH-07**: Keyboard navigation of search results

### Advanced UI

- **UI-05**: Window vibrancy effects (sidebar/material)
- **UI-06**: Custom animations and transitions
- **UI-07**: Touch Bar support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Windows/Linux support | Focus on macOS native experience first |
| CLI functionality changes | Existing CLI works, focus on app UX |
| New MCP server features | Fix existing app first, expand later |
| Touch Bar support | Low priority, defer to v2 |

## Traceability

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

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: Mon Mar 09 2026*
*Last updated: Mon Mar 09 2026 after initial definition*
