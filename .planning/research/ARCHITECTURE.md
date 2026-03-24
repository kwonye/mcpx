# Architecture Research: v1.1 UI Fixes Integration

**Domain:** Electron + React macOS Desktop App
**Researched:** 2026-03-24
**Confidence:** HIGH (codebase analysis, existing documentation)

## System Overview

The mcpx desktop app uses a layered architecture with clear separation between Electron main process, preload bridge, and React renderer. v1.1 UI fixes integrate primarily at the renderer layer with some CSS changes affecting window configuration.

```
+-----------------------------------------------------------+
|                    Electron Main Process                   |
|  +-------------+  +-------------+  +------------------+    |
|  | dashboard.ts|  | popover.ts  |  | ipc-handlers.ts  |    |
|  | (window cfg)|  | (window cfg)|  | (registry calls) |    |
|  +------+------+  +------+------+  +--------+---------+    |
|         |                |                    |            |
+---------|----------------|--------------------|------------+
          |                |                    |
+---------v----------------v--------------------v------------+
|                      Preload Bridge                         |
|  +------------------------------------------------------+  |
|  | contextBridge.exposeInMainWorld("mcpx", api)         |  |
|  +------------------------------------------------------+  |
+-----------------------------------------------------------+
          |
+---------v-------------------------------------------------+
|                    React Renderer                          |
|  +----------------+  +----------------+  +-------------+  |
|  | StatusPopover  |  |   Dashboard    |  |  BrowseTab  |  |
|  | (popover view) |  | (dashboard view|  | (registry)  |  |
|  +-------+--------+  +-------+--------+  +------+------+  |
|          |                 |                    |          |
|  +-------v-----------------v--------------------v------+  |
|  |                     index.css                        |  |
|  |  (all styling: popover, dashboard, sidebar, etc.)   |  |
|  +-----------------------------------------------------+  |
+-----------------------------------------------------------+
          |
+---------v-------------------------------------------------+
|                   Main Process (Search)                     |
|  +------------------------------------------------------+  |
|  | search-utils.ts (Fuse.js fuzzy search)               |  |
|  | registry-client.ts (fetch + filter + sort)           |  |
|  +------------------------------------------------------+  |
+-----------------------------------------------------------+
```

## Fix Integration Points

### POPOVER-01: Menu Bar Popover Scrolling

**Current State:**
- Window created in `/Users/will/Developer/kwonye/mcpx/app/src/main/popover.ts` (lines 49-67)
- Fixed dimensions: `width: 360, height: 320`
- Content rendered by `/Users/will/Developer/kwonye/mcpx/app/src/renderer/components/StatusPopover.tsx`
- Styling in `/Users/will/Developer/kwonye/mcpx/app/src/renderer/index.css` (lines 416-424 - `.popover` class)

**Problem:** The `.popover` class has `overflow` not properly configured for scrolling when content exceeds the fixed 320px height.

**Files to Modify:**
| File | Line Range | Change Type | Description |
|------|------------|-------------|-------------|
| `app/src/renderer/index.css` | 416-424 | CSS | Add `overflow-y: auto` to `.popover` main section, ensure `max-height` constraint |
| `app/src/renderer/components/StatusPopover.tsx` | 60-97 | JSX | Verify `main` element has proper flex/overflow for scrollable content |

**Integration Pattern:**
The popover uses a flex column layout with three sections:
1. `.popover-header` (fixed height) - no-drag region
2. `main` (flex: 1) - scrollable content area
3. `.popover-actions` (fixed at bottom) - no-drag region

The fix should ensure `main` section handles overflow scrolling while header/footer remain fixed.

---

### DRAG-01: Dashboard Window Drag

**Current State:**
- Window created in `/Users/will/Developer/kwonye/mcpx/app/src/main/dashboard.ts` (lines 37-47)
- Uses `titleBarStyle: "hiddenInset"` for macOS native traffic lights
- CSS `-webkit-app-region: drag` applied in `/Users/will/Developer/kwonye/mcpx/app/src/renderer/index.css`

**Problem:** The sidebar drag region (line 264) is overridden by `.sidebar-inner` which has `no-drag` (line 276). The `.page-header` drag region (line 352) is also overridden by children with `no-drag` (line 356-358).

**Files to Modify:**
| File | Line Range | Change Type | Description |
|------|------------|-------------|-------------|
| `app/src/renderer/index.css` | 258-267 | CSS | Restructure `.sidebar` drag region to include visible title bar area |
| `app/src/renderer/index.css` | 345-358 | CSS | Add dedicated drag strip above `.page-header` or expand drag region |
| `app/src/renderer/components/Dashboard.tsx` | 39-75 | JSX | May need structural changes to add explicit drag handle element |

**Integration Pattern:**
Electron's `-webkit-app-region: drag` enables window dragging. Child elements with `no-drag` become interactive. The pattern requires:
- A visible, clickable drag region (typically 28-44px height for macOS)
- All interactive elements (buttons, inputs) marked as `no-drag`

**Recommended Approach:**
Add a dedicated drag strip element in the dashboard layout:
```css
/* New class for drag strip */
.title-bar-drag-strip {
    height: 28px;
    -webkit-app-region: drag;
    flex-shrink: 0;
}
```

---

### DRAG-02: Dashboard Padding and Margins

**Current State:**
- Layout defined in `/Users/will/Developer/kwonye/mcpx/app/src/renderer/index.css` (lines 251-389)
- `.dashboard-container` - flex container, full viewport
- `.sidebar` - 240px width, 16px padding
- `.main-content` - 16px/24px padding
- `.page-header` - 72px height

**Problem:** Current padding may not follow macOS Human Interface Guidelines for window content.

**Files to Modify:**
| File | Line Range | Change Type | Description |
|------|------------|-------------|-------------|
| `app/src/renderer/index.css` | 258-267 | CSS | Adjust `.sidebar` padding |
| `app/src/renderer/index.css` | 335-343 | CSS | Adjust `.main-content` padding |
| `app/src/renderer/index.css` | 345-354 | CSS | Adjust `.page-header` height and spacing |

**macOS Conventions:**
- Standard window content inset: 20px from edges
- Sidebar typically has less padding (12-16px) since it's visually separate
- Title bar area should be 52px minimum for hiddenInset style (traffic light clearance)

---

### BROWSE-01: Browse Registry Layout

**Current State:**
- Component: `/Users/will/Developer/kwonye/mcpx/app/src/renderer/components/BrowseTab.tsx` (lines 131-222)
- Uses inline styles for most layout
- Server cards rendered in a flex column (line 167)

**Problem:** Inline styles scattered throughout component; layout may be inconsistent with rest of app.

**Files to Modify:**
| File | Line Range | Change Type | Description |
|------|------------|-------------|-------------|
| `app/src/renderer/components/BrowseTab.tsx` | 133-147 | JSX/CSS | Header and search form layout |
| `app/src/renderer/components/BrowseTab.tsx` | 167-206 | JSX/CSS | Server list card layout |
| `app/src/renderer/index.css` | (new) | CSS | Add `.browse-tab` and related classes |

**Recommended Approach:**
Extract inline styles to CSS classes in `index.css`:
- `.browse-tab` - container
- `.browse-header` - centered header section
- `.browse-search-form` - search input container
- `.browse-server-list` - server cards container
- `.browse-server-card` - individual card styling

---

### BROWSE-02: Fuzzy Search Returns Results

**Current State:**
- Search flow: Renderer -> IPC -> Main Process
- `useRegistryList` hook in `/Users/will/Developer/kwonye/mcpx/app/src/renderer/hooks/useMcpx.ts` (lines 30-117)
- Registry fetch in `/Users/will/Developer/kwonye/mcpx/app/src/main/registry-client.ts` (lines 73-110)
- Fuse.js search in `/Users/will/Developer/kwonye/mcpx/app/src/main/search-utils.ts` (lines 1-103)

**Data Flow:**
```
[BrowseTab searchInput]
       |
       v
[useRegistryList.debouncedSearch(query)]
       |
       v
[IPC.REGISTRY_LIST] --> [fetchRegistryServers()]
       |
       v
[API: registry.modelcontextprotocol.io/v0.1/servers?search=query]
       |
       v
[filterServersByQuery() + sortServersByRelevance()] <-- Fuse.js
       |
       v
[Return to renderer]
```

**Problem:** The search may be failing at multiple points:
1. Registry API not returning expected results
2. Fuse.js filter removing valid matches
3. Query not being passed correctly to API

**Files to Investigate:**
| File | Line Range | Purpose |
|------|------------|---------|
| `app/src/main/registry-client.ts` | 73-110 | Check API params and response handling |
| `app/src/main/search-utils.ts` | 17-51, 65-75 | Check Fuse.js configuration and filter logic |
| `app/src/renderer/hooks/useMcpx.ts` | 37-64 | Check query normalization and IPC call |
| `app/src/renderer/components/BrowseTab.tsx` | 42-55 | Check search trigger logic |

**Fuse.js Configuration Analysis:**
```typescript
// search-utils.ts lines 41-50
threshold: 0.4,        // Lower = stricter (0 = exact, 1 = match anything)
distance: 100,         // Search distance limit
minMatchCharLength: 2, // Minimum matching characters
```

With `threshold: 0.4`, searches like "vercel" should match if the term exists. The issue is likely:
1. API not returning servers with "vercel" in searchable fields
2. Server names like `vercel/mcp-server-vercel` may not be searched correctly

---

### BROWSE-03: Search State Persistence

**Current State:**
- `searchInput` state in `BrowseTab.tsx` (line 29)
- `activeQuery` state in `BrowseTab.tsx` (line 30)
- Both are React `useState` which resets on unmount

**Problem:** When dashboard window closes and reopens, React state is lost.

**Files to Modify:**
| File | Line Range | Change Type | Description |
|------|------------|-------------|-------------|
| `app/src/main/settings-store.ts` | (extend) | TS | Add `lastSearchQuery` to settings |
| `app/src/shared/desktop-settings.ts` | (extend) | TS | Add type for persisted search |
| `app/src/renderer/components/BrowseTab.tsx` | 29-30 | JSX | Load from settings on mount, save on change |

**Integration Pattern:**
Use existing settings persistence infrastructure:
1. Extend `DesktopSettings` type in `app/src/shared/desktop-settings.ts`
2. Add persistence in `app/src/main/settings-store.ts`
3. Load via `useMcpx` hook or direct IPC call
4. Save on search input change (debounced)

---

## Component Dependencies

```
                    +------------------+
                    |   Dashboard.tsx  |
                    +--------+---------+
                             |
           +-----------------+-----------------+
           |                 |                 |
           v                 v                 v
+----------------+  +----------------+  +----------------+
|   Sidebar      |  |  BrowseTab     |  | SettingsPanel  |
| (drag region)  |  +-------+--------+  +----------------+
+----------------+          |
                            v
                    +----------------+
                    | useRegistryList|
                    | (hook)         |
                    +-------+--------+
                            |
                            v
                    +----------------+
                    |   IPC Bridge   |
                    +-------+--------+
                            |
+---------------------------+---------------------------+
|                           |                           |
v                           v                           v
+----------------+  +----------------+  +----------------+
| registry-client|  | search-utils   |  | server-mapper  |
| (fetch API)    |  | (Fuse.js)      |  | (install flow) |
+----------------+  +----------------+  +----------------+
```

## Suggested Fix Order

Based on dependencies and user impact:

1. **BROWSE-02 (Fuzzy Search)** - Core functionality, affects user's ability to find servers
   - No dependencies on other fixes
   - Main process only, isolated changes

2. **POPOVER-01 (Popover Scrolling)** - Quick CSS fix, high visibility
   - Renderer-only, no dependencies
   - Test with various server counts

3. **DRAG-01 (Window Drag)** - Core UX issue
   - May require structural changes to Dashboard.tsx
   - Should be done before DRAG-02 (padding)

4. **DRAG-02 (Dashboard Padding)** - Polish after drag is working
   - Depends on final layout from DRAG-01
   - CSS-only changes

5. **BROWSE-01 (Layout)** - Polish, lower priority
   - Independent of other fixes
   - Consider combining with BROWSE-03

6. **BROWSE-03 (Search Persistence)** - Nice-to-have
   - Extends existing settings infrastructure
   - Can be deferred if time-constrained

## Anti-Patterns to Avoid

### Anti-Pattern 1: Inline Styles for Layout

**What people do:** Add inline `style={{ ... }}` props for quick fixes
**Why it's wrong:** Inconsistent with vanilla CSS approach, harder to maintain
**Do this instead:** Add classes to `index.css`, use CSS variables for theming

### Anti-Pattern 2: Overly Broad Drag Regions

**What people do:** Set entire sidebar/header as draggable
**Why it's wrong:** Buttons and interactive elements become unclickable
**Do this instead:** Use narrow drag strips, explicitly mark interactive elements as `no-drag`

### Anti-Pattern 3: React State for Persistent Data

**What people do:** Use useState for data that should survive remounts
**Why it's wrong:** State resets when component unmounts
**Do this instead:** Use existing settings persistence via IPC to main process

## Sources

- Codebase analysis: `app/src/renderer/index.css`, `app/src/main/dashboard.ts`, `app/src/main/popover.ts`
- Existing architecture docs: `.planning/codebase/ARCHITECTURE.md`
- Fuse.js configuration: `app/src/main/search-utils.ts`
- Registry flow: `.planning/codebase/ARCHITECTURE.md` lines 106-114

---
*Architecture research for: mcpx Desktop App v1.1 UI Fixes*
*Researched: 2026-03-24*