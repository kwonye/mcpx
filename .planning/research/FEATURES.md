# Feature Landscape

**Domain:** Electron/macOS Desktop App UI Patterns
**Researched:** 2026-03-24 (updated for v1.1 UI fixes milestone)
**Confidence:** MEDIUM (based on codebase analysis and standard macOS conventions; external search tools unavailable)

---

## Executive Summary

This research covers four UI fix areas for the v1.1 milestone: menu bar popover scrolling, dashboard window dragging, padding/margins consistency, and browse/search state behavior. The app uses Electron with React and vanilla CSS, following a `-webkit-app-region: drag` pattern for frameless window dragging. Key issues include scroll container setup, drag region conflicts with interactive elements, and search state not persisting between window opens.

---

## Table Stakes (Users Expect These)

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Popover content scrolling** | Menu bar apps must scroll when content overflows; users expect smooth scroll with subtle scrollbar | LOW | Current implementation has `overflowY: auto` on main but CSS may need adjustment for proper flex container behavior |
| **Window drag from title area** | Standard macOS behavior; users instinctively drag from top of window | LOW | Uses `-webkit-app-region: drag` but drag regions may conflict with interactive elements |
| **Consistent padding/margins** | macOS apps have standard spacing (typically 16px); inconsistent padding feels "wrong" | LOW | Sidebar uses 16px, main content has asymmetric padding |
| **Search returns matching results** | Searching "vercel" should show Vercel-related servers; broken search = broken feature | MEDIUM | Fuse.js fuzzy search with threshold 0.4; possible issue with search query handling or data format |
| **Clear empty state** | Users need feedback when search finds nothing; silence is confusing | LOW | Has empty state message but may not display correctly |
| **Interactive elements clickable** | Buttons in drag regions must work; non-clickable buttons feel broken | LOW | Requires `-webkit-app-region: no-drag` on interactive children |

---

## Differentiators (Competitive Advantage)

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Search state persistence** | Remember search query between window opens for seamless UX | MEDIUM | Currently resets on window close; would require localStorage or URL state |
| **Subtle macOS-native scrollbar** | Thin, semi-transparent scrollbar matches macOS aesthetic | LOW | CSS custom scrollbar exists but may need refinement |
| **Category quick filters** | One-click access to server categories (Trending, Databases, etc.) | LOW | Already implemented; works correctly |

---

## Anti-Features (Commonly Requested, Often Problematic)

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Persistent search across app restarts** | Registry changes make old results stale; memory overhead | Persist only the query text, not results; re-fetch on window open |
| **Auto-scroll to top on search** | Jarring if user was scrolling; disorients users | Scroll to top smoothly only if results change significantly |
| **Drag from anywhere in sidebar** | Conflicts with navigation buttons; users accidentally drag when clicking nav | Keep drag region in title bar only, not sidebar |
| **Heavy UI frameworks (Tailwind, MUI, etc.)** | Violates project mandate for vanilla CSS; adds bundle size | Use vanilla CSS with macOS system variables |

---

## Feature Dependencies

```
Window Drag Region
    └──requires──> Interactive elements have no-drag CSS
        └──requires──> Buttons/inputs properly marked

Search Functionality
    └──requires──> Fuse.js configuration correct
    └──requires──> Registry API returns expected data structure
        └──requires──> IPC bridge working (mcpx.registryList)

Popover Scrolling
    └──requires──> Flex container with defined height
    └──requires──> Content area has overflow-y: auto
        └──requires──> Header/footer outside scroll area
```

### Dependency Notes

- **Window drag requires no-drag on interactive elements:** If buttons inside drag regions don't have `-webkit-app-region: no-drag`, clicking them will attempt to drag the window instead
- **Search requires correct Fuse.js config:** Current threshold is 0.4 (fairly permissive). If results don't show, check if search query is being passed correctly to `registryList`
- **Popover scrolling requires flex structure:** The popover must have a fixed height container with header/footer outside the scrollable area

---

## Detailed Feature Analysis

### 1. Menu Bar Popover Scrolling (POPOVER-01)

**Current Implementation:**
- Window: 360x320px, frameless (`popover.ts`)
- CSS: `.popover` with `height: 100vh`, `display: flex`, `flex-direction: column` (`index.css`)
- Main content area: `overflowY: "auto"` (inline style in `StatusPopover.tsx`)

**Expected Behavior:**
- Popover has fixed height (320px from window dimensions)
- Header remains at top (not scrollable)
- Footer remains at bottom (not scrollable)
- Main content area scrolls vertically when content exceeds available space
- Scrollbar should be thin (6px) and semi-transparent (matches macOS style)
- Mouse wheel/trackpad scrolling should work smoothly
- Scroll should not affect window position

**Common Pitfalls:**
- `height: 100vh` on `.popover` inside a frameless window may not behave as expected
- Parent container needs explicit height for `overflow-y: auto` to work
- Missing `flex-shrink: 0` on header/footer can cause them to collapse

**Fix Approach:**
```css
.popover {
  height: 100%; /* Use 100% instead of 100vh */
  display: flex;
  flex-direction: column;
}
.popover-header {
  flex-shrink: 0; /* Prevent collapse */
}
.popover main {
  flex: 1;
  overflow-y: auto;
  min-height: 0; /* Critical for flex children to scroll */
}
.popover-actions {
  flex-shrink: 0;
}
```

---

### 2. Window Drag Behavior (DRAG-01)

**Current Implementation:**
- Dashboard: `titleBarStyle: "hiddenInset"` (native macOS traffic lights, hidden title bar) in `dashboard.ts`
- CSS: `-webkit-app-region: drag` on `.sidebar` and `.page-header` (`index.css`)
- CSS: `-webkit-app-region: no-drag` on `.sidebar-inner` and children

**Expected Behavior:**
- Users can drag window by clicking in the sidebar area (outside buttons)
- Users can drag window by clicking in the page header area (outside interactive elements)
- Traffic lights (close, minimize, maximize) work correctly at top-left (positioned at 16px, 16px)
- All buttons, inputs, and clickable elements work normally (don't trigger drag)
- Cursor remains default (not move cursor) over drag regions

**Common Pitfalls:**
- Applying `drag` to parent and not `no-drag` to children makes children unclickable
- Overlapping drag regions can cause unexpected behavior
- Elements with `pointer-events: none` cannot have their app-region overridden

**Fix Approach:**
1. Ensure `.sidebar` has `drag` but `.sidebar-inner` and all interactive children have `no-drag`
2. Ensure `.page-header` has `drag` but all children have `no-drag`
3. Verify traffic light position doesn't overlap with interactive elements

**Current CSS Review (`index.css` lines 264-276):**
```css
.sidebar {
    width: 240px;
    flex-shrink: 0;
    padding: 16px;
    position: relative;
    z-index: 10;
    -webkit-app-region: drag;  /* Drag region */
    display: flex;
    flex-direction: column;
}

.sidebar-inner {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    padding: 16px;
    -webkit-app-region: no-drag;  /* Interactive content */
}
```

**Issue:** The `.sidebar-logo` area is inside `.sidebar-inner` and should be clickable for branding, but `.nav-button` elements need to remain clickable. Current implementation looks correct - verify at runtime.

---

### 3. macOS Padding/Margins (DRAG-02)

**Current Implementation:**
- Sidebar: `padding: 16px`
- Main content: `padding: 16px 24px 16px 0` (asymmetric)
- Page header: `height: 72px`, `margin-bottom: 16px`

**macOS Conventions:**
| Element | Standard | Current | Status |
|---------|----------|---------|--------|
| Sidebar padding | 16px | 16px | Correct |
| Sidebar width | 200-260px | 240px | Correct |
| Content padding | 16-24px | 16px 24px 16px 0 | Asymmetric - investigate |
| Traffic light position | 12-20px from top-left | 16px, 16px | Correct |
| Card/list padding | 12-16px | 16px | Correct |
| Border radius | 8-16px | 8px/16px/24px | Correct |

**Issues Found:**
- Main content has `padding-right: 0` but no right padding on actual content
- Asymmetric padding (16px left, 0 right) may cause alignment issues with the glass panel borders

**Fix Approach:**
```css
.main-content {
  padding: 16px 24px; /* Consistent padding */
}
```

Or adjust per-component if the current asymmetry is intentional for visual balance with the sidebar.

---

### 4. Browse/Search State Behavior (BROWSE-01, BROWSE-02, BROWSE-03)

**Current Implementation:**
- Hook: `useRegistryList` in `hooks/useMcpx.ts` manages `servers`, `cursor`, `loading` state
- Search: Debounced 300ms, calls `window.mcpx.registryList(undefined, query, limit)`
- Fuse.js config: Threshold 0.4, searches `server.name`, `server.title`, `server.description`, `server.packages[].identifier`
- State: React state only (no persistence)

**Expected Behavior:**
- Typing in search input triggers debounced search (300ms delay)
- Results update to show matching servers
- "vercel" search should return servers with "vercel" in name/title/description
- Loading state shows while fetching
- Empty state message shows when no results
- Load more button appears if there are more results

**Known Issues from CONCERNS.md:**
- `repository` field accessed in `search-utils.ts` but not in `RegistryServerEntry` type definition
- Debug `console.log` left in `registry-client.ts` (line 85)

**Common Pitfalls:**
- Fuse.js `server.name` path may not match actual data structure (nested `server.server.name`)
- Registry API response format may differ from expected type
- Search query not passed correctly through IPC

**Fix Approach:**
1. Verify `RegistryServerEntry` type matches actual API response structure
2. Check Fuse.js key paths: `server.name` vs actual path in data
3. Add `repository` field to `RegistryServerEntry["server"]` type if needed
4. Remove debug `console.log` from `registry-client.ts`

**Current Fuse.js Configuration (`search-utils.ts`):**
```typescript
const keys: Fuse.FuseOptionKey<RegistryServerEntry>[] = [];

if (fields.includes("name")) {
  keys.push({ name: "server.name", weight: 0.7 });
}
if (fields.includes("title")) {
  keys.push({ name: "server.title", weight: 0.5 });
}
if (fields.includes("description")) {
  keys.push({ name: "server.description", weight: 0.3 });
}
if (fields.includes("repository")) {
  keys.push({ name: "server.repository.url", weight: 0.2 }); // Type mismatch!
}
if (fields.includes("packages")) {
  keys.push({ name: "server.packages.identifier", weight: 0.4 });
}
```

**Issue:** The `repository` field is accessed but not defined in the `RegistryServerEntry` type.

---

### 5. Search State Persistence (BROWSE-03)

**Current Behavior:**
- Search input value is React state (`searchInput`)
- Resets to empty string when component mounts
- No persistence between window opens/closes

**Expected Behavior Options:**
| Option | Behavior | Complexity |
|--------|----------|------------|
| **No persistence (current)** | Fresh state on each window open | N/A |
| **Query-only persistence** | Save `searchInput` to localStorage, restore on mount | LOW |
| **Full state persistence** | Save `searchInput`, `activeCategory`, `activeQuery` | MEDIUM |

**Recommendation:** Query-only persistence - simple implementation, useful UX

```typescript
// In BrowseTab.tsx
const [searchInput, setSearchInput] = useState(() => {
  return localStorage.getItem("mcpx-browse-query") || "";
});

// On search input change
const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const value = e.target.value;
  setSearchInput(value);
  localStorage.setItem("mcpx-browse-query", value);
  debouncedSearch(value);
};
```

---

## MVP Definition

### Launch With (v1.1 Fixes)

- [ ] **POPOVER-01: Fix menu bar popover scrolling** — Content must scroll within popover; header and footer should remain fixed
- [ ] **DRAG-01: Fix dashboard window drag** — Title bar area must be draggable; interactive elements must not trigger drag
- [ ] **DRAG-02: Fix dashboard padding** — Use consistent macOS-standard padding (16px for most elements)
- [ ] **BROWSE-01: Fix browse registry layout** — Cards should be properly spaced and aligned
- [ ] **BROWSE-02: Fix fuzzy search** — Searching "vercel" or other terms must return matching results
- [ ] **BROWSE-03: Search state persistence** — Optionally persist search query between window opens

### Add After Validation (v1.x)

- [ ] **Advanced search state** — Persist search query to localStorage, restore on window reopen
- [ ] **Keyboard shortcuts** — Cmd+F to focus search, Esc to clear
- [ ] **Search history** — Show recent searches for quick access

### Future Consideration (v2+)

- [ ] **Full-text search** — Search within server descriptions and README content
- [ ] **Filter by category** — Server-side category filtering instead of client-side query mapping
- [ ] **Highlight matched terms** — Show users why a result matched

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Popover scrolling fix | HIGH | LOW | P1 |
| Window drag fix | HIGH | LOW | P1 |
| Padding fix | MEDIUM | LOW | P1 |
| Search results fix | HIGH | MEDIUM | P1 |
| Search state persistence | MEDIUM | MEDIUM | P2 |
| Layout polish | MEDIUM | LOW | P1 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Raycast | Bitbar/xbar | Our Approach |
|---------|---------|-------------|--------------|
| Popover scroll | Native scroll, fixed header/footer | Native scroll | Flex container with overflow-y: auto |
| Window drag | Native title bar | N/A (menu bar only) | hiddenInset + CSS drag regions |
| Search | Instant, persistent | Basic filter | Debounced fuzzy search |
| Layout | Consistent 8px grid | Variable | CSS custom properties |

---

## Sources

- Codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/CONCERNS.md`
- Electron documentation: `-webkit-app-region` for drag regions (standard Electron pattern)
- macOS Human Interface Guidelines: Standard padding (16px), title bar conventions
- Fuse.js documentation: Fuzzy search configuration options
- Existing E2E tests: `app/e2e/search.spec.ts`, `app/e2e/ui.spec.ts`

---

*Feature research for: Electron/macOS UI patterns*
*Researched: 2026-03-24*