# Feature Landscape

**Domain:** Electron desktop app (macOS) — MCP server management
**Researched:** 2026-03-09

## Executive Summary

This research covers three targeted features for the mcpx desktop app: fuzzy search with ranking, macOS native UI polish, and tray icon design. The app currently has basic substring matching for search but needs proper fuzzy search. The UI needs to follow macOS Human Interface Guidelines for a native feel. The tray icon needs to use macOS template image format for proper light/dark mode support.

---

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Fuzzy search with typo tolerance** | Users expect search to find results even with typos or partial matches (e.g., "filesystem" → "file system") | Medium | Current implementation uses simple `includes()` — needs Fuse.js or similar |
| **Relevance-ranked results** | Search results should be ordered by relevance, not just filtered | Low | Current `calculateRelevanceScore()` exists but doesn't use fuzzy matching |
| **Template tray icon** | macOS menu bar icons must adapt to light/dark mode automatically | Low | Requires `*Template.png` naming convention + 16x16 + 32x32@2x assets |
| **Native macOS UI feel** | Users expect apps to feel at home on macOS (system fonts, spacing, colors) | Medium | Requires vanilla CSS updates, no new dependencies |
| **Responsive search** | Search should filter as user types without lag | Low | Current implementation is synchronous and fast, but needs Fuse.js indexing |

---

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Customizable search weights** | Power users can tune which fields matter most (name vs. description) | Low | Fuse.js supports weighted keys via `keys` option |
| **Highlight matched terms** | Show users *why* a result matched by highlighting search terms in results | Medium | Requires Fuse.js result indices + React rendering logic |
| **Keyboard-first navigation** | Full keyboard accessibility for search (arrow keys, Enter to select) | Medium | Expected by power users, often overlooked |
| **SF Symbols integration** | Use Apple's SF Symbols for consistent iconography throughout the app | Low | Electron `nativeImage.createFromNamedImage()` supports SF Symbols |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Heavy UI frameworks (Tailwind, MUI, etc.)** | Violates project mandate for vanilla CSS; adds bundle size without proportional value | Use vanilla CSS with macOS system variables (`-apple-system`, `system-ui`) |
| **Server-side search** | Overkill for <1000 registry entries; adds latency and complexity | Keep search client-side with Fuse.js |
| **Complex search syntax (Boolean operators, regex)** | MCP server discovery is simple use case; complexity harms DX | Stick to simple fuzzy matching with field weights |
| **Custom icon design tool** | Out of scope for MCP management app | Provide design spec for tray icon, use asset pipeline |

---

## Feature Dependencies

```
Fuzzy Search (Fuse.js) → Relevance Ranking (existing scoring can use Fuse.js scores)
Template Tray Icon → Proper macOS light/dark mode support
macOS Native UI → System font adoption, native spacing, color palette
```

---

## Detailed Feature Analysis

### 1. Fuzzy Search with Ranking

**Current State:**
- `app/src/main/search-utils.ts` implements `matchSearchQuery()` using `includes()` substring matching
- `calculateRelevanceScore()` provides basic scoring but requires exact substring matches
- No typo tolerance ("filesytem" won't match "filesystem")

**Expected Behavior (Electron/React apps):**
- **Typo tolerance**: 1-2 character edits should still match (Levenshtein distance)
- **Partial matching**: "filesys" should match "filesystem"
- **Field weighting**: Matches in `name` field should rank higher than `description`
- **Instant results**: Search should feel responsive (<50ms for <1000 items)

**Recommended Implementation:**
| Library | Why | Install |
|---------|-----|---------|
| **Fuse.js** (v7.1.0) | Industry standard, 20k+ stars, zero dependencies, TypeScript support | `npm install fuse.js` |
| Alternative: `flexsearch` | Faster for very large datasets (>10k items), but mcpx registry is small | — Not recommended |

**Fuse.js Integration Pattern:**
```typescript
import Fuse from 'fuse.js'
import type { RegistryServerEntry } from './registry-client'

const fuse = new Fuse(servers, {
  keys: [
    { name: 'server.name', weight: 3 },
    { name: 'server.title', weight: 2 },
    { name: 'server.description', weight: 1 },
    { name: 'server.packages[].identifier', weight: 2 }
  ],
  threshold: 0.4, // 0 = exact match, 1 = match anything
  ignoreLocation: true, // Don't require match at specific position
  minMatchCharLength: 2
})

const results = fuse.search(query) // Returns scored, ranked results
```

**Migration Path:**
1. Keep existing `search-utils.ts` API signature for backward compatibility
2. Replace internal implementation with Fuse.js
3. Use Fuse.js scores for ranking (replace `calculateRelevanceScore()`)
4. Add `includeMatches: true` option if implementing highlight feature later

---

### 2. macOS Native UI Polish

**Current State:**
- Vanilla CSS (per project mandate) — good foundation
- Needs alignment with macOS Human Interface Guidelines

**Expected Behavior (macOS apps):**
| UI Element | macOS Standard | Implementation |
|------------|----------------|----------------|
| **System Font** | `-apple-system, BlinkMacSystemFont, sans-serif` | Update `font-family` in `app/src/renderer/index.css` |
| **Window Controls** | Red/yellow/green traffic lights (left) | Electron `titleBarStyle: 'hiddenInset'` for native feel |
| **Spacing** | 8px grid system (8, 16, 24, 32px) | Define CSS variables: `--spacing-xs: 8px`, etc. |
| **Colors** | System semantic colors | Use CSS variables mapped to macOS colors |
| **Sidebar** | Vibrancy/blur effect (optional) | Electron `vibrancy: 'sidebar'` or CSS backdrop-filter |
| **Selection** | Blue highlight (`#0063E1`) | Update `::selection` and active states |

**CSS Variables to Add:**
```css
:root {
  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Typography */
  --font-system: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --font-size-lg: 17px;

  /* Colors (light mode) */
  --color-bg: #ffffff;
  --color-bg-secondary: #f5f5f7;
  --color-text: #1d1d1f;
  --color-text-secondary: #6e6e73;
  --color-accent: #0063E1;
  --color-border: #d2d2d7;

  /* Dark mode (via @media) */
  @media (prefers-color-scheme: dark) {
    --color-bg: #1e1e1e;
    --color-bg-secondary: #2c2c2e;
    --color-text: #f5f5f7;
    --color-text-secondary: #98989d;
    --color-border: #3a3a3c;
  }
}
```

**Electron Window Configuration:**
```typescript
// app/src/main/dashboard.ts
const win = new BrowserWindow({
  width: 800,
  height: 600,
  titleBarStyle: 'hiddenInset', // Native macOS traffic light position
  vibrancy: 'sidebar', // Optional: sidebar blur effect
  visualEffectState: 'active', // Maintain vibrancy when focused
  backgroundColor: '#ffffff'
})
```

---

### 3. Tray Icon Design

**Current State:**
- Existing tray icon in `app/resources/` (described as "ugly" in PROJECT.md)
- Needs redesign with proper macOS template format

**macOS Tray Icon Requirements:**
| Requirement | Specification | Why |
|-------------|---------------|-----|
| **Template format** | Filename must end with `Template` (e.g., `iconTemplate.png`) | macOS auto-inverts for light/dark menu bar |
| **Sizes** | 16x16 (72dpi) + 32x32@2x (144dpi) | Standard + Retina support |
| **Colors** | Black (#000000) with alpha channel only | Template images ignore color, use alpha for shape |
| **No filled areas** | Avoid large solid regions | Template images should be outline/drawing style |

**File Structure:**
```
app/resources/
├── trayIconTemplate.png      # 16x16, 72dpi
├── trayIconTemplate@2x.png   # 32x32, 144dpi
└── trayIconTemplate@3x.png   # 48x48, 144dpi (optional, for high-DPI external displays)
```

**Implementation:**
```typescript
// app/src/main/tray.ts
import { nativeImage, Tray, Menu } from 'electron'
import path from 'path'

const iconPath = path.join(__dirname, '../../resources/trayIconTemplate.png')
const trayIcon = nativeImage.createFromPath(iconPath)
trayIcon.setTemplateImage(true) // Explicitly mark as template

const tray = new Tray(trayIcon)
```

**Design Guidelines:**
- **Style**: Simple, recognizable at 16x16 size
- **Metaphor**: Server/gateway/connection visual (aligns with MCP gateway purpose)
- **Avoid**: Text, gradients, shadows, complex details
- **Reference Icons**: 
  - Docker tray icon (whale silhouette)
  - ngrok tray icon (arrow/forward symbol)
  - Vercel CLI (triangle/vertex)

**SF Symbol Alternative:**
```typescript
// Use Apple's built-in SF Symbols instead of custom assets
const trayIcon = nativeImage.createFromNamedImage('server.rack')
// Or: 'network', 'globe', 'cloud', 'connection.lan'
trayIcon.setTemplateImage(true)
```

**Recommended SF Symbol**: `server.rack` or `network` — directly communicates server/gateway function.

---

## MVP Recommendation

**Phase 1: Foundation**
1. Add Fuse.js dependency (`npm install fuse.js`)
2. Replace search implementation in `search-utils.ts` with Fuse.js
3. Design and implement tray icon with template format

**Phase 2: Polish**
4. Update CSS variables for macOS native feel
5. Add keyboard navigation to search
6. Implement search term highlighting (if Fuse.js `includeMatches` enabled)

**Defer:**
- Custom search weight UI (power user feature)
- SF Symbols throughout app (can use standard PNG assets first)

---

## Sources

- **Fuse.js**: https://fusejs.io/ — Official documentation
- **Fuse.js GitHub**: https://github.com/krisk/Fuse — 20k+ stars, v7.1.0 (Feb 2025)
- **Electron Tray API**: https://www.electronjs.org/docs/latest/api/tray — Official Electron docs
- **Electron Native Image**: https://www.electronjs.org/docs/latest/api/native-image — Template image specifications
- **macOS Human Interface Guidelines**: https://developer.apple.com/design/human-interface-guidelines — Apple design standards
- **Existing Codebase**: `app/src/main/search-utils.ts` — Current search implementation
