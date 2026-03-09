# Project Research Summary

**Project:** mcpx Desktop App Fixes
**Domain:** Electron + React macOS Desktop Application
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

This is a targeted fix milestone for an existing Electron + React desktop application (mcpx) that manages MCP servers. The app has a solid foundation (Electron 35.x, React 19.1.x, TypeScript 5.9.3, vanilla CSS) but requires fixes in four critical areas: app launch crashes, fuzzy search implementation, macOS tray icon design, and native UI polish. Research confirms these are well-understood problems with established solutions in the Electron ecosystem.

The recommended approach prioritizes stability first (crash fixes), then user-facing functionality (search + tray icon), and finally polish (macOS HIG compliance). Fuse.js 7.1.0 is the clear choice for fuzzy search—zero dependencies, actively maintained (Feb 2025 release), and industry standard with 20k+ stars. Tray icon implementation must follow macOS template image conventions precisely, with module-level variable storage to prevent garbage collection. All fixes leverage existing architecture patterns (@mcpx/core integration, IPC bridge, vanilla CSS theming).

Key risks center on Electron initialization timing (accessing APIs before `app.whenReady()`), tray icon garbage collection, and search performance blocking the main process. These are mitigated through established patterns: wrap all initialization in `app.whenReady()`, store tray references at module scope, and implement debounced search with result limiting.

## Key Findings

### Recommended Stack

**Core technologies:**
- **Fuse.js 7.1.0**: Fuzzy search engine — zero dependencies, 6KB gzipped, actively maintained (Feb 2025), industry standard with 20k+ stars
- **VSCode Debugger + `--inspect-brk`**: Crash debugging — built-in V8 inspector support, no external tools needed
- **Electron `crashReporter` API**: Crash reporting — uses Crashpad for local crash dump storage during development
- **macOS Template Images**: Tray icons — `*Template.png` naming convention with 16x16 + 32x32@2x assets for automatic light/dark mode adaptation

**Critical requirements:**
- Tray icon filenames must end with `Template` suffix (macOS auto-inverts for theme)
- Store `Tray` instance in module-level variable (prevents garbage collection)
- All Electron API calls must occur after `app.whenReady()` resolves
- Disable asset hashing for tray icons in build config (preserve `Template` naming)

### Expected Features

**Must have (table stakes):**
- **Fuzzy search with typo tolerance** — users expect "filesytem" to match "filesystem"
- **Relevance-ranked results** — search results ordered by match quality, not just filtered
- **Template tray icon** — macOS menu bar icons must adapt to light/dark mode automatically
- **Native macOS UI feel** — system fonts, proper spacing, semantic colors
- **Responsive search** — instant filtering without lag as user types

**Should have (competitive):**
- **Highlight matched terms** — show users why results matched
- **Keyboard-first navigation** — arrow keys + Enter for search selection
- **SF Symbols integration** — Apple's built-in iconography (`server.rack`, `network`)
- **Customizable search weights** — power users can tune field importance

**Defer (v2+):**
- Custom search weight UI (power user feature)
- SF Symbols throughout entire app (use PNG assets first)
- Complex search syntax (Boolean operators, regex)

### Architecture Approach

The app uses a three-process Electron architecture with direct CLI core integration via TypeScript path alias (`@mcpx/core`).

**Major components:**
1. **Main Process** (`app/src/main/`) — App lifecycle, tray management, window creation, IPC handlers, daemon control
2. **Preload Process** (`app/src/preload/`) — Context bridge exposing typed `window.mcpx` API to renderer
3. **Renderer Process** (`app/src/renderer/`) — React UI (Dashboard, BrowseTab, ServerCard components) with vanilla CSS
4. **CLI Core Library** (`cli/src/core/`) — Shared business logic (config, daemon, sync, secrets, registry)

**Key patterns:**
- IPC handler registration centralized in `ipc-handlers.ts`
- CSS variable theming for dark/light mode support
- Daemon lifecycle tracked in main process, exposed via IPC
- Client-side search with relevance scoring (Fuse.js replaces current `includes()`)

### Critical Pitfalls

1. **Tray icon garbage collection** — Tray disappears after minutes; prevent by storing `Tray` instance in module-level variable, never in function scope
2. **Non-template tray icons** — Icons appear grainy/inverted; use `*Template.png` naming with 16x16 + 32x32@2x, black/white with alpha channel only
3. **Accessing Electron APIs before `app.ready`** — Crashes on launch; wrap all initialization in `app.whenReady().then()`, register macOS events (`open-file`) before ready
4. **Main process blocking during search** — UI freezes when typing; implement 250-300ms debounce, limit results to top 20, pre-index data on app start
5. **Incorrect fuzzy search configuration** — Poor ranking; configure field weights (`name: 0.7`, `description: 0.3`), set `threshold: 0.4`, enable `includeScore` for tuning
6. **Ignoring macOS HIG** — App feels "ugly/foreign"; use system fonts, 8px grid spacing, native traffic light positioning, dark mode support via `nativeTheme`

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Launch Stability & Crash Fixes
**Rationale:** Foundation first—app must launch reliably before adding features. Addresses highest-severity pitfalls (crash on launch, API timing).
**Delivers:** Stable app launch 10/10 times, proper error handling, debugging infrastructure
**Addresses:** LAUNCH-01, LAUNCH-02
**Avoids:** "Accessing Electron APIs before app.ready" pitfall, "Context isolation breakage" pitfall
**Research needed:** No—well-documented Electron patterns, official docs cover all requirements

### Phase 2: Fuzzy Search Implementation
**Rationale:** Core user-facing feature. Depends on stable launch. Requires Fuse.js integration and search UI updates.
**Delivers:** Typo-tolerant search with relevance ranking, debounced input, result limiting
**Addresses:** SEARCH-01, SEARCH-02
**Uses:** Fuse.js 7.1.0, existing `search-utils.ts` API (backward-compatible replacement)
**Implements:** Client-side fuzzy matching with weighted field scoring
**Avoids:** "Main process blocking during search" pitfall, "Incorrect fuzzy search configuration" pitfall
**Research needed:** No—Fuse.js documentation is comprehensive, integration pattern is standard

### Phase 3: Tray Icon & Menu Bar Integration
**Rationale:** macOS-specific requirement for menu bar apps. Independent of search, but depends on stable launch.
**Delivers:** Proper template tray icon (16x16 + 32x32@2x), light/dark mode adaptation, context menu
**Addresses:** ICON-01
**Uses:** Electron `Tray` API, `nativeImage.createFromPath()`, macOS template image format
**Avoids:** "Tray icon garbage collection" pitfall, "Non-template tray icons" pitfall
**Research needed:** No—Electron docs + Apple HIG are definitive sources

### Phase 4: macOS UI Polish
**Rationale:** Visual refinement after functional fixes. Requires design audit against macOS HIG.
**Delivers:** Native macOS feel—system fonts, proper spacing, dark mode, hover states, keyboard navigation
**Addresses:** UI-01, UI-02
**Uses:** Vanilla CSS with CSS variables, `-apple-system` font stack, 8px grid
**Avoids:** "Ignoring macOS HIG" pitfall
**Research needed:** Minimal—Apple HIG is authoritative, but design decisions need validation

### Phase Ordering Rationale

- **Launch first** because all other features depend on app running reliably
- **Search before tray** because search is core functionality (tray is polish for macOS)
- **UI polish last** because it's iterative refinement on top of working features
- **Grouping** follows component boundaries: main process fixes (Phase 1), search logic (Phase 2), tray assets + main process (Phase 3), renderer CSS (Phase 4)

### Research Flags

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Well-documented Electron initialization patterns, official docs cover all requirements
- **Phase 2:** Fuse.js integration is standard, extensive documentation + examples available
- **Phase 3:** Electron Tray API + macOS template images are covered in official docs

**Phases needing design validation (not deep research):**
- **Phase 4:** macOS HIG is authoritative, but design decisions (spacing values, color palette) need visual validation during implementation

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Fuse.js docs + Electron official docs + Apple HIG all verified |
| Features | HIGH | FEATURES.md aligns with Electron app expectations, MVP priorities are clear |
| Architecture | HIGH | Existing codebase provides clear patterns, no architectural changes required |
| Pitfalls | HIGH | PITFALLS.md covers all critical issues with specific prevention strategies |

**Overall confidence:** HIGH

### Gaps to Address

- **Tray icon design:** Research specifies technical requirements (template format, sizes) but doesn't provide actual icon design. Need design spec or SF Symbol selection during Phase 3.
- **Search result highlighting:** Listed as differentiator but implementation details (using Fuse.js `includeMatches` + React rendering) need validation during Phase 2.
- **Dark mode testing:** macOS dark mode support requires physical device testing—cannot fully validate in development environment without Retina display.

## Sources

### Primary (HIGH confidence)
- **Electron Documentation** — Tray API, App lifecycle, Crash Reporter, Debugging guides (https://www.electronjs.org/docs/latest/)
- **Fuse.js Documentation** — Official docs + GitHub (20k+ stars, v7.1.0 Feb 2025) (https://fusejs.io/)
- **Apple Human Interface Guidelines** — macOS menu bar, icons, spacing conventions (https://developer.apple.com/design/human-interface-guidelines/)

### Secondary (MEDIUM confidence)
- **Electron GitHub Issues** — Common crash patterns, tray GC discussions
- **Existing codebase** — `app/src/main/search-utils.ts`, `app/src/main/tray.ts`, `cli/src/core/` modules

### Tertiary (LOW confidence)
- **Community post-mortems** — Electron app launch failures (anecdotal, needs validation)

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
