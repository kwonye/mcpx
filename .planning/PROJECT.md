# mcpx Desktop App Fixes

## What This Is

The mcpx desktop app is a macOS Electron application that provides a GUI for managing MCP (Model Context Protocol) servers and cross-client installation. This project focuses on fixing critical UI bugs and polishing the user experience.

## Core Value

A reliable, polished desktop app that makes MCP server management effortless and intuitive.

## Current Milestone: v1.1 Desktop App Fixes

**Goal:** Fix all broken UI components and interactions discovered after v1.0.

**Target features:**
- Fix menu bar popover scrolling
- Fix dashboard window drag and padding
- Fix browse registry layout and search
- Polish all UI interactions

## Requirements

### Validated

- ✓ MCP server management capabilities — v1.0
- ✓ Cross-client installer functionality — v1.0
- ✓ CLI integration via @mcpx/core — v1.0
- ✓ Fuzzy search with Fuse.js — v1.0 (implementation exists, has bugs)
- ✓ Tray icon with dark mode support — v1.0
- ✓ Dark mode UI theme — v1.0
- ✓ **BROWSE-02**: Fuzzy search returns matching results — Phase 5 (2026-03-24)
- ✓ **POPOVER-01**: Menu bar popover content scrolls properly — Phase 6 (2026-03-25)
- ✓ **POPOVER-02**: No duplicate buttons in popover — Phase 6 (2026-03-25)
- ✓ **WIND-01**: Dashboard window can be dragged from title bar area — Phase 7 (2026-03-25)

### Active

- [ ] **WIND-02**: Dashboard padding and margins follow macOS conventions
- [ ] **SIDE-01**: Daemon start/stop controls at top of sidebar
- [ ] **BROWSE-01**: Browse registry layout is clean and organized
- [ ] **BROWSE-03**: Search state persists between window opens
- [ ] **PASTE-01**: Paste command uses multi-line layout

### Out of Scope

- New MCP server features — focus on fixing existing functionality
- Windows/Linux support — macOS only
- New features of any kind — purely fixes and polish

## Context

**Existing codebase:** Brownfield project with comprehensive architecture documentation in `.planning/codebase/`.

**Tech stack:** Electron + React + TypeScript with vanilla CSS styling.

**Issues discovered after v1.0:**
1. Menu bar popover scrolling is broken
2. Dashboard window cannot be dragged from title area
3. Dashboard padding/margins are wrong
4. Browse registry layout is scrambled and messy
5. Fuzzy search doesn't return results (e.g., searching "vercel" shows nothing)
6. Search state doesn't persist between window opens

## Constraints

- **[Tech stack]**: Electron + React + vanilla CSS — established stack, don't add heavy UI frameworks
- **[Platform]**: macOS only — leverage native macOS conventions
- **[Architecture]**: Maintain @mcpx/core integration from CLI — shared business logic
- **[Scope]**: Fixes only — no new features

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Focus on fixes only | Core functionality is broken, adding features would compound problems | — Pending |
| Systematic UI fixes | Multiple interrelated issues need coordinated approach | — Pending |

---
*Last updated: Tue Mar 25 2026 after Phase 7: Window Drag Fix complete*