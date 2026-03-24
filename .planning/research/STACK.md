# Stack Research

**Domain:** Electron/macOS UI Fixes
**Researched:** 2026-03-24
**Confidence:** MEDIUM (based on codebase analysis and established Electron patterns; web search APIs unavailable for verification)

## Context

This research is scoped to specific UI fixes needed for the mcpx desktop app:
- Menu bar popover scrolling
- Dashboard window drag from title area
- Dashboard padding/margins
- Browse registry layout fixes
- Fuzzy search debugging

The base stack is validated (Electron 35.x, React 19.1.x, TypeScript 5.9.3, vanilla CSS, Fuse.js 7.1.0).

---

## Recommended Approaches

### 1. Window Dragging in hiddenInset Windows

| API/Property | Purpose | Why |
|--------------|---------|-----|
| `-webkit-app-region: drag` | CSS property for draggable regions | Standard Electron mechanism for frameless/hiddenInset windows |
| `-webkit-app-region: no-drag` | Exclude interactive elements from drag | Buttons, inputs must remain clickable |
| `titleBarStyle: "hiddenInset"` | macOS native traffic lights in content | Gives macOS-native look while allowing custom layout |
| `trafficLightPosition: { x, y }` | Position traffic lights | Adjusts where close/minimize/maximize appear |

**Current Implementation Analysis:**

The dashboard (`app/src/main/dashboard.ts`) uses:
```typescript
titleBarStyle: "hiddenInset",
trafficLightPosition: { x: 16, y: 16 },
```

The CSS (`app/src/renderer/index.css`) has:
```css
.sidebar {
    -webkit-app-region: drag;  /* Sidebar is draggable */
}
.sidebar-inner {
    -webkit-app-region: no-drag;  /* But contents are not */
}
.page-header {
    -webkit-app-region: drag;  /* Header is draggable */
}
.page-header > * {
    -webkit-app-region: no-drag;  /* But children are not */
}
```

**Problem Diagnosis:**

The traffic lights are positioned at `{ x: 16, y: 16 }`. With `hiddenInset`, the traffic lights appear inside the content area. The sidebar starts at `padding: 16px` from the edge, meaning the traffic lights likely overlap with the sidebar content.

**Recommended Fix:**

1. **Account for traffic light area**: macOS traffic lights take approximately 52px width and are positioned from the left. The sidebar needs to start after this area.

```css
.sidebar {
    /* Add left padding to account for traffic lights */
    padding-left: 72px; /* 16px existing + ~52px for traffic lights + buffer */
    /* OR use a drag region above the sidebar */
}

/* Alternative: Create dedicated drag region */
.title-bar-drag-region {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 52px; /* macOS title bar height */
    -webkit-app-region: drag;
    z-index: 100;
}
```

2. **Fix page-header drag region**: Currently the page-header is draggable but this conflicts with window controls. The title area should be draggable but account for traffic lights.

**Verification Steps:**
1. Check if traffic lights overlap sidebar logo
2. Test dragging from various areas of the window
3. Ensure buttons remain clickable (not consumed by drag region)

---

### 2. Menu Bar Popover Scrolling

| CSS Property | Value | Why |
|--------------|-------|-----|
| `overflow-y: auto` | Enable vertical scrolling | Standard overflow handling |
| `flex: 1` with `min-height: 0` | Allow flex child to shrink | Critical for overflow in flex containers |
| `height: 100vh` with `overflow: hidden` on parent | Constrain popover height | Prevents content from expanding beyond window |

**Current Implementation Analysis:**

The popover window (`app/src/main/popover.ts`):
```typescript
width: 360,
height: 320,
```

The CSS (`app/src/renderer/index.css`):
```css
.popover {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 16px;
    gap: 16px;
    -webkit-app-region: drag;
}
```

The StatusPopover component (`app/src/renderer/components/StatusPopover.tsx`):
```tsx
<main style={{ flex: 1, overflowY: "auto", ... }}>
    {/* Content */}
</main>
```

**Problem Diagnosis:**

1. **Missing `min-height: 0`**: In flexbox, children won't shrink below their content size by default. The `<main>` element needs `min-height: 0` to allow overflow scrolling.

2. **Drag region interference**: The entire `.popover` has `-webkit-app-region: drag`, but the `<main>` content needs scrolling. The scroll events might be captured by the drag region.

3. **Height constraint**: The `height: 100vh` on `.popover` is correct, but the flex layout might not be constraining children properly.

**Recommended Fix:**

```css
.popover {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 16px;
    gap: 16px;
    overflow: hidden; /* Prevent popover itself from scrolling */
}

.popover-header {
    flex-shrink: 0; /* Don't shrink header */
    -webkit-app-region: no-drag;
}

.popover main {
    flex: 1;
    min-height: 0; /* CRITICAL: Allow shrinking for overflow */
    overflow-y: auto;
    -webkit-app-region: no-drag; /* Allow scrolling, not dragging */
}

.popover-actions {
    flex-shrink: 0; /* Don't shrink footer */
    -webkit-app-region: no-drag;
}
```

**Key Pattern:**

The `min-height: 0` trick is essential for flexbox scrolling. Without it, the flex child will expand to fit its content rather than shrink to fit the parent, preventing overflow from ever triggering.

---

### 3. macOS Human Interface Guidelines Spacing Values

| Element | Value | Notes |
|---------|-------|-------|
| Window content margin | 20pt | Standard macOS window padding |
| Sidebar width | 200-240pt | Typical sidebar dimensions |
| Sidebar padding | 16-20pt | Internal sidebar padding |
| Toolbar/title bar height | 52pt | Standard macOS title bar height with hiddenInset |
| Traffic light area width | ~52pt | Space needed for close/minimize/maximize buttons |
| Standard spacing increments | 4pt, 8pt, 12pt, 16pt, 20pt, 24pt | Apple uses 4pt grid |
| Control spacing | 8pt | Between related controls |
| Section spacing | 16-24pt | Between distinct sections |
| Group spacing | 20pt | Between major groups |

**Applying to Dashboard:**

```css
/* Standard macOS window layout */
.dashboard-container {
    /* Account for traffic lights on left edge */
    --traffic-light-width: 52px;
    --window-margin: 20px;
}

.sidebar {
    width: 240px; /* Standard sidebar width */
    padding: 16px;
    padding-left: calc(16px + var(--traffic-light-width)); /* Account for traffic lights */
}

.main-content {
    padding: 16px 24px 16px 0; /* Top Right Bottom Left */
}

.page-header {
    height: 52px; /* Match title bar height */
    margin-bottom: 16px; /* Standard section spacing */
}
```

**Window Drag Region:**

With `hiddenInset`, the traffic lights are in your content area. You need:

1. **A drag region above content**: A 52px tall area at the top of the window for dragging
2. **Non-overlapping traffic lights**: The traffic lights at `{ x: 16, y: 16 }` need clear space

---

### 4. Electron Window State Persistence

| Approach | Complexity | When to Use |
|----------|------------|-------------|
| Manual save/restore | Low | Simple position/size persistence |
| `electron-window-state` | Low-Medium | Battle-tested, handles multi-display |
| Custom with `browserWindow.getBounds()` | Medium | Full control, includes maximized state |

**Recommended Approach: Manual Save/Restore**

For the dashboard window, persist position and size across sessions:

```typescript
// app/src/main/dashboard.ts
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

interface WindowState {
    x?: number
    y?: number
    width: number
    height: number
    isMaximized?: boolean
}

const DEFAULT_STATE: WindowState = {
    width: 900,
    height: 650
}

function getStatePath(): string {
    return path.join(app.getPath('userData'), 'dashboard-state.json')
}

function loadWindowState(): WindowState {
    try {
        const data = fs.readFileSync(getStatePath(), 'utf-8')
        return { ...DEFAULT_STATE, ...JSON.parse(data) }
    } catch {
        return DEFAULT_STATE
    }
}

function saveWindowState(state: WindowState): void {
    fs.writeFileSync(getStatePath(), JSON.stringify(state))
}

export function openDashboard(): BrowserWindow {
    const state = loadWindowState()

    const dashboard = new BrowserWindow({
        ...state,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        // ... other options
    })

    // Save state on close
    dashboard.on('close', () => {
        const bounds = dashboard.getBounds()
        saveWindowState({
            ...bounds,
            isMaximized: dashboard.isMaximized()
        })
    })

    // ... rest of setup
}
```

**For Search State Persistence:**

The search state (query, category) should persist between window opens. This is renderer state:

```typescript
// In BrowseTab.tsx
const [searchInput, setSearchInput] = useState(() => {
    // Restore from sessionStorage or a persisted store
    return sessionStorage.getItem('browse-search') || ''
})
```

Or use the main process to persist via IPC:

```typescript
// Save search state when window closes
window.addEventListener('beforeunload', () => {
    window.mcpx.saveBrowseState({ searchInput, activeCategory })
})
```

---

### 5. Fuzzy Search Debugging (Fuse.js)

| Configuration | Current Value | Recommendation |
|---------------|---------------|----------------|
| `threshold` | 0.4 | Lower for stricter matching, raise for more results |
| `distance` | 100 | How far to search for a match |
| `minMatchCharLength` | 2 | Single char searches won't work |
| `ignoreLocation` | true | Search entire string, not just near beginning |
| `findAllMatches` | true | Find all matches, not just first |

**Current Implementation Analysis:**

From `app/src/main/search-utils.ts`:

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
// ...

return new Fuse(servers, {
    keys,
    threshold: 0.4,
    distance: 100,
    minMatchCharLength: 2,
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
});
```

**Why "vercel" Might Not Match:**

1. **Threshold too strict**: 0.4 is moderately strict. Fuzzy matches might score higher than 0.4 and be excluded.

2. **Nested key paths**: The keys are `server.name`, `server.title`, etc. Ensure the data structure matches:
   ```typescript
   // Expected structure
   { server: { name: "com.vercel.mcp-server", title: "Vercel MCP", ... } }
   ```

3. **Search query processing**: Check if the search query is being normalized correctly (trimmed, lowercased).

**Debugging Steps:**

1. **Log the Fuse index creation**:
   ```typescript
   console.log("Creating Fuse index with servers:", servers.length);
   console.log("Sample server:", JSON.stringify(servers[0], null, 2));
   ```

2. **Log search results with scores**:
   ```typescript
   const results = fuse.search("vercel");
   console.log("Search results:", results.map(r => ({
       name: r.item.server.name,
       score: r.score
   })));
   ```

3. **Check if data exists**:
   ```typescript
   const hasVercel = servers.some(s =>
       s.server.name?.toLowerCase().includes("vercel") ||
       s.server.title?.toLowerCase().includes("vercel")
   );
   console.log("Has vercel in data:", hasVercel);
   ```

**Recommended Configuration for Better Matching:**

```typescript
return new Fuse(servers, {
    keys,
    threshold: 0.5,  // Slightly looser - allows more matches
    distance: 200,   // Search further in strings
    minMatchCharLength: 1,  // Allow single char searches
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
    useExtendedSearch: true,  // Enable advanced search syntax
});
```

**Alternative: Check Registry API First**

The registry client (`app/src/main/registry-client.ts`) sends search queries to the API:
```typescript
params.set("search", normalizedQuery);
```

Check if the API returns results before Fuse filtering:
```typescript
console.log("API returned servers:", data.servers?.length);
```

If the API returns 0 results for "vercel", the issue is upstream, not Fuse.js.

---

## Installation

No new dependencies required. All fixes use existing Electron APIs and CSS patterns.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Manual window state | `electron-window-state` package | Adds dependency for simple use case |
| CSS `-webkit-app-region` | Custom draggable title bar div | Native CSS is more reliable |
| Fuse.js with adjusted config | Replace with different library | Fuse.js is already integrated; tune first |
| Vanilla CSS flexbox | CSS Grid for popover | Flexbox is correct for vertical layout |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `overflow: auto` on outer container | Can cause double scrollbars | `overflow: hidden` on parent, `overflow-y: auto` on scrollable child |
| `height: 100%` on flex children | Can prevent shrinking | `flex: 1` with `min-height: 0` |
| Large `-webkit-app-region: drag` areas | Breaks scrolling and clicking | Specific drag regions with `no-drag` for interactive elements |
| High Fuse.js threshold (>0.5) | Returns too many irrelevant matches | Start at 0.4-0.5, adjust based on results |

---

## Version Compatibility

| Package | Version | Notes |
|---------|---------|-------|
| Electron | 35.x | Current version in use |
| React | 19.1.x | Current version in use |
| Fuse.js | 7.1.0 | Current version in use |
| Node.js | >= 20 | Required by CLI |

---

## Sources

- Electron BrowserWindow API — titleBarStyle, trafficLightPosition (training data, HIGH confidence for Electron patterns)
- CSS Flexbox overflow patterns — MDN documentation (training data, HIGH confidence)
- macOS Human Interface Guidelines — Apple developer documentation (training data, MEDIUM confidence for specific values)
- Fuse.js configuration — fusejs.io (training data, HIGH confidence for API)
- Electron `-webkit-app-region` — Electron documentation (training data, HIGH confidence)

**Note:** Web search APIs were unavailable during this research session. Recommendations are based on established Electron patterns and training data. For production implementation, verify with:
- [Electron BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window)
- [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Fuse.js API](https://fusejs.io/api/options.html)

---

*Stack research for: Electron/macOS UI fixes*
*Researched: 2026-03-24*