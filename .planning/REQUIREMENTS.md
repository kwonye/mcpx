# Requirements: mcpx Desktop App Fixes

**Defined:** Mon Mar 09 2026
**Core Value:** A reliable, polished desktop app that makes MCP server management effortless and intuitive.

## v1 Requirements

### Launch Stability

- [x] **LAUNCH-01**: App launches successfully without crashing on startup
- [x] **LAUNCH-02**: App window renders content correctly after launch
- [x] **LAUNCH-03**: App handles macOS lifecycle events (window-all-closed prevents quit)

### Search

- [x] **SEARCH-01**: Search returns partial/fuzzy matches (not exact match only)
- [x] **SEARCH-02**: Search results ranked by priority/popularity
- [x] **SEARCH-03**: Search input debounced to prevent UI freezing
- [x] **SEARCH-04**: Search supports typo tolerance

### Tray Icon

- [x] **ICON-01**: New menu bar tray icon designed and implemented
- [x] **ICON-02**: Tray icon uses macOS template format (auto-inverts for dark mode)
- [x] **ICON-03**: Tray icon provided at 16x16 and 32x32@2x resolutions
- [x] **ICON-04**: Tray reference held at module level (prevents garbage collection)

### UI Polish

- [x] **UI-01**: UI follows macOS Human Interface Guidelines
- [x] **UI-02**: Visual polish applied to all components (spacing, fonts, colors)
- [x] **UI-03**: Dark mode support verified
- [x] **UI-04**: Window uses hiddenInset title bar for native macOS controls

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
| LAUNCH-01 | Phase 1 | ✓ Complete |
| LAUNCH-02 | Phase 1 | ✓ Complete |
| LAUNCH-03 | Phase 1 | ✓ Complete |
| SEARCH-01 | Phase 2 | ✓ Complete |
| SEARCH-02 | Phase 2 | ✓ Complete |
| SEARCH-03 | Phase 2 | ✓ Complete |
| SEARCH-04 | Phase 2 | ✓ Complete |
| ICON-01 | Phase 3 | ✓ Complete |
| ICON-02 | Phase 3 | ✓ Complete |
| ICON-03 | Phase 3 | ✓ Complete |
| ICON-04 | Phase 3 | ✓ Complete |
| UI-01 | Phase 4 | ✓ Complete |
| UI-02 | Phase 4 | ✓ Complete |
| UI-03 | Phase 4 | ✓ Complete |
| UI-04 | Phase 4 | ✓ Complete |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓
- Completed: 15/15 (100%)

**Phase Breakdown:**
- Phase 1 (Launch Stability): 3 requirements ✓ COMPLETE
- Phase 2 (Fuzzy Search): 4 requirements ✓ COMPLETE
- Phase 3 (Tray Icon): 4 requirements ✓ COMPLETE
- Phase 4 (macOS UI Polish): 4 requirements ✓ COMPLETE

---
*Requirements defined: Mon Mar 09 2026*
*Completed: Sun Mar 12 2026*
