# mcpx Desktop App Fixes

## What This Is

The mcpx desktop app is a macOS Electron application that provides a GUI for managing MCP (Model Context Protocol) servers and cross-client installation. This project focuses on fixing critical issues and polishing the user experience.

## Core Value

A reliable, polished desktop app that makes MCP server management effortless and intuitive.

## Requirements

### Validated

- ✓ Existing MCP server management capabilities — existing codebase
- ✓ Cross-client installer functionality — existing codebase
- ✓ CLI integration via @mcpx/core — existing codebase

### Active

- [ ] **LAUNCH-01**: App launches successfully without crashing on startup
- [ ] **LAUNCH-02**: App window renders content correctly after launch
- [ ] **SEARCH-01**: Search returns partial matches (fuzzy matching)
- [ ] **SEARCH-02**: Search results ranked by priority/popularity
- [ ] **UI-01**: UI follows macOS Human Interface Guidelines
- [ ] **UI-02**: Visual polish applied to all components
- [ ] **ICON-01**: New menu bar tray icon designed and implemented

### Out of Scope

- CLI functionality changes — existing CLI works, focus on app
- New MCP server features — fix existing app first
- Windows/Linux support — macOS only for now

## Context

**Existing codebase:** Brownfield project with comprehensive architecture documentation in `.planning/codebase/`.

**Tech stack:** Electron + React + TypeScript with vanilla CSS styling.

**Known issues to address:**
1. App crashes on launch (recent regression)
2. Search requires exact match — needs fuzzy matching with ranking
3. UI described as "ugly" — needs macOS native polish
4. Menu bar icon described as "ugly" — needs new design

## Constraints

- **[Tech stack]**: Electron + React + vanilla CSS — established stack, don't add heavy UI frameworks
- **[Platform]**: macOS only — leverage native macOS conventions
- **[Architecture]**: Maintain @mcpx/core integration from CLI — shared business logic

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fuzzy search implementation | Better UX than exact match | — Pending |
| macOS native UI direction | Users expect native feel on macOS | — Pending |
| Custom tray icon design | Current icon doesn't meet quality bar | — Pending |

---
*Last updated: Mon Mar 09 2026 after initialization*
