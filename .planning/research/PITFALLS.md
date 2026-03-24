# Domain Pitfalls: Electron Desktop App Fixes

**Domain:** Electron macOS Desktop Application
**Researched:** Mon Mar 09 2026 (updated for v1.1 UI fixes: Mon Mar 24 2026)
**Confidence:** HIGH

---

## v1.1 Milestone: UI Fix Pitfalls

The following pitfalls are specific to FIXING broken UI components in the existing Electron + React macOS app. These focus on common mistakes when implementing popover scrolling, window dragging, and search in Electron/macOS apps.

### Critical Pitfall: App-Region Drag Blocks Scroll Events

**What goes wrong:**
Setting `-webkit-app-region: drag` on a container element causes scroll wheel/trackpad events to be captured by the drag system, preventing child elements from scrolling even when they have `-webkit-app-region: no-drag` and `overflow: auto`.

**Why it happens:**
The `-webkit-app-region` CSS property was designed for window dragging, not for complex interactive layouts. When a parent has `drag`, Chromium's event handling prioritizes the drag behavior over scroll gestures. The `no-drag` exemption only makes elements interactive (clickable, focusable) but does not restore scroll gesture handling on macOS trackpad.

**Current code issue:**
The `.popover` CSS class has `-webkit-app-region: drag` on the container. The scroll container `<main style={{ flex: 1, overflowY: "auto" }}>` has `no-drag`, but scroll events are still blocked.

**How to avoid:**
1. Do NOT set `-webkit-app-region: drag` on any ancestor of scrollable content
2. Only apply `drag` to dedicated non-scrolling header/title bar areas
3. Structure DOM so scrollable containers are siblings of draggable regions, not descendants
4. For menubar popovers: make the entire popover `no-drag` since the window is already positioned correctly

**Warning signs:**
- Scroll container has `overflow: auto` but content doesn't scroll
- Works in browser DevTools but not in Electron app on actual hardware
- Trackpad two-finger gesture does nothing

**Phase to address:**
POPOVER-01 (Popover scrolling fix)

---

### Critical Pitfall: Incorrect Draggable Region Placement for hiddenInset

**What goes wrong:**
With `titleBarStyle: "hiddenInset"` on macOS, the window cannot be dragged from the expected title bar area because the draggable region is placed incorrectly (e.g., in a sidebar on the left instead of across the top of the window).

**Why it happens:**
Developers often misunderstand that `titleBarStyle: "hiddenInset"` removes the title bar but still requires an explicit `-webkit-app-region: drag` element at the TOP of the window. The traffic lights (close/minimize/maximize buttons) are positioned independently via `trafficLightPosition: { x: 16, y: 16 }`, and users expect to drag the window by the empty space around them.

**Current code issue:**
The CSS has `-webkit-app-region: drag` on `.sidebar` (left side) and `.page-header` (top area), but the sidebar's drag region doesn't help with window title bar dragging. The traffic lights are at `{ x: 16, y: 16 }` but there's no explicit drag strip above the sidebar.

**How to avoid:**
1. Create a dedicated drag region element at the TOP of the window (full width)
2. Position it as an overlay or part of the header area
3. Height should be at least 32px for reliable drag target
4. Ensure traffic light positions don't overlap with interactive elements
5. For sidebar layouts: the drag region must span the ENTIRE top edge, including above the sidebar

**Warning signs:**
- Clicking and dragging in the title area selects text instead of moving window
- Drag works only from specific, unexpected areas
- Traffic lights are present but window feels "stuck"

**Phase to address:**
DRAG-01 (Dashboard window drag fix)

---

### Critical Pitfall: Fuse.js minMatchCharLength Prevents Short Queries

**What goes wrong:**
Fuzzy search returns no results for short queries (1-2 characters) because `minMatchCharLength: 2` in the Fuse.js configuration.

**Why it happens:**
Developers set `minMatchCharLength` to filter out noise from single-character matches, but this also blocks legitimate short searches. Users expect searching "v" to return results containing "v" or starting with "v".

**Current code issue:**
In `app/src/main/search-utils.ts`, the Fuse.js config has `minMatchCharLength: 2`, which prevents single-character matches.

**How to avoid:**
1. Set `minMatchCharLength: 1` for general search
2. Or remove the setting entirely (default is 1)
3. Use `threshold` to control match strictness instead
4. Consider `ignoreLocation: true` for better substring matching

**Warning signs:**
- Short queries return empty results (e.g., "v" for "vercel")
- Users type full words to get any results
- Search feels "unresponsive" to partial input

**Phase to address:**
BROWSE-02 (Fuzzy search fix)

---

### Critical Pitfall: React State Does Not Persist Across Window Lifecycle

**What goes wrong:**
Search input, active filters, and scroll position reset to defaults when the dashboard window is closed and reopened because React state is stored in component memory, which is destroyed when the window closes.

**Why it happens:**
Electron windows are full browser contexts. When a BrowserWindow is closed, all JavaScript state is garbage collected. The current implementation uses `useState` for search state without any persistence mechanism.

**Current code issue:**
`BrowseTab.tsx` uses `useState` for `searchInput`, `activeQuery`, `activeCategory`. `useRegistryList` hook uses `useState` for `servers`, `cursor`. When dashboard closes, all state is lost.

**How to avoid:**
1. Use `localStorage` for non-sensitive UI state (search terms, active tabs)
2. Store scroll position in a parent component that persists (if using single-page architecture)
3. For Electron: consider keeping window hidden instead of closed (if appropriate)
4. Use `electron-store` or similar for cross-session persistence
5. Implement state hydration on component mount

**Warning signs:**
- State resets between window opens
- Users complain about losing their work/selections
- Each window open feels like a fresh app launch

**Phase to address:**
BROWSE-03 (Search state persistence)

---

### Moderate Pitfall: Sidebar Padding Inside Draggable Region Creates Hit-Testing Issues

**What goes wrong:**
When a sidebar has `-webkit-app-region: drag` with internal padding, the padding area becomes draggable but the content inside is not. This creates an inconsistent hit-testing experience.

**Why it happens:**
The `-webkit-app-region` property applies to the entire bounding box of the element, including padding. If the sidebar has `padding: 16px` and `-webkit-app-region: drag`, the padding area becomes a drag handle while the inner content (with `-webkit-app-region: no-drag`) is interactive.

**Current code issue:**
`.sidebar` has `padding: 16px` and `-webkit-app-region: drag`. The `.sidebar-inner` has `-webkit-app-region: no-drag`. This creates inconsistent behavior across the sidebar area.

**How to avoid:**
1. Keep draggable regions separate from content areas
2. Use wrapper elements: outer drag wrapper with no padding, inner content with padding
3. Or structure so the drag region is a thin strip, not a full-width sidebar
4. Test by clicking in various positions to verify expected behavior

**Warning signs:**
- Clicking in sidebar padding drags the window unexpectedly
- Traffic lights overlap with interactive elements
- Inconsistent behavior across the same visual region

**Phase to address:**
DRAG-02 (Dashboard padding fix)

---

### Moderate Pitfall: Fuse.js Threshold Too Strict for Fuzzy Matching

**What goes wrong:**
Setting `threshold: 0.4` in Fuse.js can be too strict for some queries, especially when users expect more lenient "contains" matching rather than strict fuzzy matching.

**Current code issue:**
The config uses `threshold: 0.4, distance: 100` which is reasonable, but combined with `minMatchCharLength: 2`, short queries fail.

**How to avoid:**
- Test with various query lengths and typos
- Consider `threshold: 0.5` for more lenient matching
- The `ignoreLocation: true` setting helps with substring matching

**Phase to address:**
BROWSE-02 (Fuzzy search fix)

---

### Moderate Pitfall: RegistryServerEntry Type Missing repository Field

**What goes wrong:**
The Fuse.js configuration searches `"server.repository.url"` but `RegistryServerEntry["server"]` doesn't include the `repository` field in its type definition, causing silent undefined matches.

**Current code issue:**
`app/src/main/search-utils.ts` uses keys like `"server.repository.url"` but `app/src/main/registry-client.ts` type doesn't define `repository` on the server object.

**How to avoid:**
- Update the type to include `repository?: { url: string; subfolder?: string }`
- Or remove the repository key from Fuse.js config if not needed

**Phase to address:**
BROWSE-02 (Fuzzy search fix)

---

### Minor Pitfall: Untyped React State Causes Runtime Bugs

**What goes wrong:**
`useStatus()` and `useRegistryList()` use `unknown` types, forcing consumers to cast or use `as any`, which bypasses TypeScript safety.

**Current code issue:**
`useRegistryList` uses `useState<unknown[]>([])` for servers. The deduplication filter uses `(s: any)`.

**How to avoid:**
- Define proper types for status and server data
- Import types from shared definitions
- Enable TypeScript to catch property access errors at compile time

**Phase to address:**
BROWSE-02 or BROWSE-03

---

### Minor Pitfall: Debug Console.log Left in Production Code

**What goes wrong:**
`console.log("[fetchRegistryServers] fetching URL:...")` in `registry-client.ts` logs to console on every registry API call.

**Current code issue:**
Line 85 of `app/src/main/registry-client.ts`.

**How to avoid:**
- Remove or gate debug logging behind environment check
- Use `console.error` for errors only

**Phase to address:**
BROWSE-02 (Fuzzy search fix)

---

## v1.1 Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `unknown` types in hooks | Fast initial implementation | Runtime bugs, no IDE support | Never - define proper types |
| Inline CSS for layout overrides | Quick fixes | Inconsistent styling, hard to maintain | Prototype only |
| Missing state persistence | Simpler code | Poor UX, user complaints | MVP only, fix before 1.0 |
| App-region on scrollable parent | Quick drag implementation | Scroll completely broken | Never |

## v1.1 Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Fuse.js with nested objects | Wrong key paths like `"name"` instead of `"server.name"` | Match key paths to actual data structure |
| Electron `-webkit-app-region` | Applying to scrollable parents | Only apply to non-scrolling header areas |
| React state in Electron | Expecting state to persist across window closes | Use localStorage or keep window hidden |

## v1.1 "Looks Done But Isn't" Checklist

- [ ] **Popover scrolling:** Often works in DevTools but not on actual trackpad - test on real hardware
- [ ] **Window drag:** Often works from some areas but not all - test clicking in multiple positions
- [ ] **Search results:** Often works for some queries but not others - test with short, long, and typo queries
- [ ] **State persistence:** Often works during testing when window stays open - test close/reopen cycle
- [ ] **CSS padding:** Often looks correct visually - test actual hit-testing behavior

## v1.1 Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| App-region scroll blocking | HIGH | Restructure DOM, move scroll containers outside drag regions |
| Missing drag region | MEDIUM | Add dedicated drag element at top of window |
| Fuse.js config issues | LOW | Adjust threshold/minMatchCharLength settings |
| No state persistence | MEDIUM | Add localStorage or electron-store |
| Type definitions missing | LOW | Add missing fields to TypeScript interfaces |

## v1.1 Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| App-region drag blocks scroll | POPOVER-01 | Test popover scrolling on trackpad |
| Incorrect draggable region | DRAG-01 | Test window drag from title bar area |
| Fuse.js minMatchCharLength | BROWSE-02 | Test short queries (1-2 chars) |
| React state not persisting | BROWSE-03 | Test close/reopen with active search |
| Sidebar padding in drag region | DRAG-02 | Test hit-testing in sidebar area |
| Missing repository type | BROWSE-02 | Verify TypeScript compiles without errors |
| Untyped React state | BROWSE-02 or BROWSE-03 | Verify no `as any` casts needed |
| Debug console.log | BROWSE-02 | Check console is clean during search |

---

## Original Research (v1.0)

The following pitfalls were identified for the original v1.0 development.

### Pitfall 1: Tray Icon Garbage Collection

**What goes wrong:**
The tray icon disappears from the macOS menu bar after a few minutes of the app running, even though the app is still running in the background.

**Why it happens:**
JavaScript garbage collection destroys the `Tray` instance when the variable goes out of scope. This is a classic JavaScript memory management issue that catches many Electron developers off guard. The tray is created inside a function scope (e.g., `app.whenReady().then(() => { const tray = new Tray(...) })`) and gets garbage collected once the promise resolves.

**How to avoid:**
- Store the tray instance in a module-level variable (using `let` at the top of the file)
- Never create the tray inside a function scope without external reference
- Use `let tray = null` at module scope, then assign in the ready handler

```typescript
// WRONG - tray gets garbage collected
app.whenReady().then(() => {
  const tray = new Tray('/path/to/icon.png')
})

// CORRECT - tray persists
let tray: Tray | null = null
app.whenReady().then(() => {
  tray = new Tray('/path/to/icon.png')
})
```

**Warning signs:**
- Tray appears on launch but vanishes unpredictably
- No errors in console (silent failure)
- Issue is timing-dependent (harder to reproduce in dev tools)

**Phase to address:**
ICON-01 (Tray icon design and implementation)

---

### Pitfall 2: Non-Template Tray Icons on macOS

**What goes wrong:**
The tray icon appears grainy, inverted, or doesn't adapt to macOS dark/light mode. The icon may look correct on some macOS versions but broken on others.

**Why it happens:**
macOS requires tray icons to be **Template Images** - black and white images with alpha channel that the system automatically styles based on the menu bar appearance. Developers often use full-color PNGs or JPEGs which don't integrate with macOS native appearance. Additionally, bundlers like webpack can mangle filenames, breaking the `Template` naming convention macOS requires.

**How to avoid:**
- Use template images (black/white with alpha, no color)
- Name files with `Template` suffix: `iconTemplate.png`
- Provide both 16x16 (72dpi) and 32x32@2x (144dpi) versions
- Ensure bundler doesn't hash or mangle the template filename
- The @2x image must have the same base filename for macOS to use it

```typescript
// CORRECT - Template naming convention
const tray = new Tray(path.join(__dirname, '../assets/iconTemplate.png'))

// WRONG - bundler may hash this
const tray = new Tray(require('../assets/icon.png'))
```

**Warning signs:**
- Icon looks inverted in dark mode
- Icon appears grainy on Retina displays
- Icon doesn't match system theme changes

**Phase to address:**
ICON-01 (Tray icon design and implementation)

---

### Pitfall 3: Accessing Electron APIs Before App Ready

**What goes wrong:**
The app crashes on launch with cryptic errors like "Cannot read property of undefined" or "Electron API can only be used after app is ready". This is the #1 cause of Electron launch crashes.

**Why it happens:**
Electron's main process modules (especially `app`, `BrowserWindow`, `Tray`) can only be used **after** the `app.whenReady()` promise resolves or the `ready` event fires. Developers often call these APIs in the top-level module scope or in async functions that execute before initialization completes. Additionally, some APIs have process restrictions - `app` only works in main process, `webFrame` only in renderer.

**How to avoid:**
- Wrap all app initialization in `app.whenReady().then(() => { ... })`
- Use `app.isReady()` to check before accessing APIs
- Never access `BrowserWindow`, `Tray`, or `Menu` at module scope
- For macOS-specific events (`open-file`, `open-url`), register listeners **before** `ready` fires

```typescript
// WRONG - crashes on launch
const win = new BrowserWindow({ width: 800, height: 600 })

// CORRECT - wait for ready
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600 })
})

// CRITICAL - macOS file events need early registration
app.on('open-file', (event, path) => {
  // Handle file open
})
// Then wait for ready for window creation
app.whenReady().then(() => { /* ... */ })
```

**Warning signs:**
- App crashes immediately on launch
- Error mentions "undefined" or "cannot read property"
- Works in development but crashes in production build
- Different crash behavior on macOS vs Windows/Linux

**Phase to address:**
LAUNCH-01, LAUNCH-02 (App launch and window rendering fixes)

---

### Pitfall 4: Main Process Blocking During Fuzzy Search

**What goes wrong:**
The UI freezes completely when the user types in the search box. Search results appear with noticeable delay, making the app feel unresponsive and sluggish.

**Why it happens:**
Fuzzy search algorithms (like Fuse.js) are CPU-intensive. Running them in the main process or renderer process without debouncing blocks the event loop. Electron's main process handles all native API calls and window management - blocking it freezes the entire app. Even in the renderer, large datasets cause visible jank.

**How to avoid:**
- Implement search debouncing (200-300ms delay after typing stops)
- Use fuzzy search libraries optimized for client-side (Fuse.js is excellent)
- For large datasets (1000+ items), consider Web Workers or utility processes
- Pre-index searchable data when the app starts, not on each search
- Limit result set size (show top 10-20 matches, not all matches)

```typescript
// WRONG - searches on every keystroke, no debounce
searchInput.addEventListener('input', (e) => {
  const results = fuse.search(e.target.value) // Blocks UI
  renderResults(results)
})

// CORRECT - debounced search
let searchTimeout: NodeJS.Timeout
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    const results = fuse.search(e.target.value).slice(0, 20) // Limit results
    renderResults(results)
  }, 250)
})
```

**Warning signs:**
- Typing feels laggy
- Search results appear noticeably after typing stops
- Entire app window becomes unresponsive during search
- CPU spikes when search runs

**Phase to address:**
SEARCH-01, SEARCH-02 (Fuzzy search implementation and ranking)

---

### Pitfall 5: Ignoring macOS Human Interface Guidelines

**What goes wrong:**
The app feels "foreign" or "ugly" to macOS users. UI elements don't match native macOS conventions - wrong spacing, incorrect font sizes, non-standard interactions. Users perceive the app as low-quality despite functional correctness.

**Why it happens:**
Electron apps are fundamentally web technologies wrapped in a native shell. Developers often ship web-style UIs without adapting to macOS conventions. Common violations include: incorrect window traffic light positioning, missing macOS-style menus, wrong sidebar widths, improper use of system fonts, and ignoring macOS spacing/alignment standards.

**How to avoid:**
- Use system fonts: `-apple-system, BlinkMacSystemFont, sans-serif`
- Follow macOS spacing: 10-12px padding minimum, 16px for content areas
- Implement standard macOS menu bar (File, Edit, View, Window, Help)
- Use native window controls position (traffic lights on left)
- Support macOS dark mode via `nativeTheme` API
- Match macOS sidebar width: 200-240px for navigation
- Use macOS-style focus rings and selection states

```css
/* WRONG - web-style spacing */
.window { padding: 20px; }
.button { border-radius: 4px; }

/* CORRECT - macOS native feel */
.window {
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  padding: 12px;
}
.button {
  border-radius: 6px; /* macOS uses rounder corners */
  height: 28px; /* Standard macOS button height */
}
```

**Warning signs:**
- Users describe UI as "ugly" or "not native"
- UI looks identical across Windows and macOS (should differ)
- Missing standard macOS menus or keyboard shortcuts
- Dark mode doesn't work or looks broken

**Phase to address:**
UI-01, UI-02 (macOS HIG compliance and visual polish)

---

### Pitfall 6: Incorrect Fuzzy Search Configuration

**What goes wrong:**
Fuzzy search returns irrelevant results, ranks poor matches higher than good matches, or misses obvious partial matches. Users lose trust in search functionality.

**Why it happens:**
Fuzzy search libraries like Fuse.js have many configuration options that dramatically affect result quality. Default settings may not match the data structure or use case. Common issues: not weighting important fields higher, incorrect threshold settings, not configuring key search paths for nested data, or ignoring result scoring.

**How to avoid:**
- Configure `keys` with weights for field importance
- Set appropriate `threshold` (lower = stricter matching, 0.3-0.5 is typical)
- Enable `includeScore` to understand and tune ranking
- Use `shouldSort: true` for relevance-based ordering
- Configure nested key paths correctly (e.g., `author.firstName`)
- Test with real user search queries, not just developer expectations

```typescript
// WRONG - default settings, no tuning
const fuse = new Fuse(servers, { keys: ['name', 'description'] })

// CORRECT - configured for relevance
const fuse = new Fuse(servers, {
  keys: [
    { name: 'name', weight: 0.7 },      // Name is most important
    { name: 'description', weight: 0.3 } // Description secondary
  ],
  threshold: 0.4,      // Balance between strict and lenient
  includeScore: true,  // Debug ranking
  shouldSort: true,    // Sort by relevance
  minMatchCharLength: 2, // Avoid matching single characters
  findAllMatches: true // Find all matches, not just first
})
```

**Warning signs:**
- Search returns results but they seem randomly ordered
- Exact matches rank lower than fuzzy matches
- Search misses obvious partial matches
- Users complain search "doesn't work" despite returning results

**Phase to address:**
SEARCH-01, SEARCH-02 (Fuzzy search implementation and ranking)

---

### Pitfall 7: Not Handling Context Isolation Correctly

**What goes wrong:**
The renderer process cannot access IPC methods or exposed APIs, or security vulnerabilities are introduced by exposing too much functionality to the renderer.

**Why it happens:**
Electron enables `contextIsolation: true` by default for security. This prevents direct access to Node.js APIs and Electron modules from the renderer. Developers either break functionality by not exposing needed APIs, or compromise security by using `nodeIntegration: true` (deprecated and dangerous).

**How to avoid:**
- Use `contextBridge.exposeInMainWorld()` to safely expose APIs
- Never enable `nodeIntegration` unless absolutely necessary
- Expose only specific methods, not entire modules
- Validate all data crossing the context bridge
- Use TypeScript types for exposed APIs

```typescript
// preload.js - CORRECT pattern
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcpxAPI', {
  getServers: () => ipcRenderer.invoke('get-servers'),
  installServer: (name) => ipcRenderer.invoke('install-server', name),
  onServerUpdate: (callback) => {
    ipcRenderer.on('server-update', (_, data) => callback(data))
  }
})

// renderer.ts - Type-safe usage
interface McpxAPI {
  getServers: () => Promise<Server[]>
  installServer: (name: string) => Promise<void>
  onServerUpdate: (callback: (data: UpdateData) => void) => void
}
declare global {
  interface Window { mcpxAPI: McpxAPI }
}
```

**Warning signs:**
- `window.require` is undefined in renderer
- IPC calls fail silently or throw errors
- TypeScript shows errors on `window.myAPI`
- Security warnings in console about context isolation

**Phase to address:**
LAUNCH-02 (Window rendering and IPC setup)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoding tray icon path | Quick prototype | Breaks in production builds | Never - always use `path.join(__dirname, ...)` |
| Skipping debouncing on search | Faster initial implementation | UI freezes, poor UX | Never for user-facing search |
| Using `nodeIntegration: true` | Easier IPC initially | Major security vulnerability | Never - use contextBridge |
| Copy-pasting search config | Saves initial setup time | Poor search quality, user frustration | Only for MVP, must tune before release |
| Ignoring @2x icon assets | Faster icon iteration | Grainy icons on Retina displays | Never for macOS apps |
| Using web-style UI components | Faster than native styling | App feels "ugly" and non-native | Only for internal tools, never user-facing |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Tray Icons** | Using full-color PNGs | Use template images (black/white with alpha) |
| **Tray Icons** | Creating tray in function scope | Store tray in module-level variable |
| **Tray Icons** | Letting bundler hash filenames | Configure bundler to preserve `Template` suffix |
| **App Launch** | Creating windows before `ready` | Wrap in `app.whenReady().then()` |
| **macOS Events** | Registering `open-file` after `ready` | Register macOS-specific events immediately |
| **IPC** | Passing complex objects directly | Serialize to JSON, validate on receiving end |
| **Dark Mode** | Hardcoding light/dark colors | Use CSS custom properties with `nativeTheme` listeners |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| **Blocking main process** | App freezes during operations | Use utility processes for CPU-intensive work | Immediate - user notices on first use |
| **Unbounded search results** | Search slows as server list grows | Limit results to top 20, paginate if needed | ~100 searchable items |
| **No search result caching** | Same search recalculated repeatedly | Cache recent searches, use Fuse.js index | ~50 searches per session |
| **Excessive IPC traffic** | UI lag, high memory usage | Batch IPC messages, debounce frequent updates | ~100 messages/second |
| **Large preload scripts** | Slow window creation | Only expose necessary APIs, lazy load rest | ~500+ lines in preload |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| **Enabling `nodeIntegration`** | Renderer can access full Node.js, remote code execution | Use `contextBridge` with specific exposed methods |
| **Exposing entire modules** | Too much surface area for attacks | Expose only needed methods, validate inputs |
| **No IPC validation** | Malicious data from renderer to main | Validate all IPC parameters with Zod or similar |
| **Hardcoded secrets in app** | Credentials extractable via dev tools | Use `safeStorage` API or macOS Keychain |
| **Disabling `webSecurity`** | XSS vulnerabilities, data theft | Never disable web security in production |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| **Search requires exact match** | Users can't find servers with typos or partial names | Implement fuzzy search with reasonable threshold |
| **No search result ranking** | Irrelevant results shown first | Weight important fields higher, sort by score |
| **No search feedback** | Users don't know if search is working | Show "Searching..." indicator, result count |
| **Instant search on every keystroke** | Laggy, janky typing experience | Debounce search by 250-300ms |
| **Tray icon doesn't match system theme** | App looks out of place, unprofessional | Use template images that adapt to dark/light mode |
| **Window doesn't restore position** | Users lose workflow context | Save/restore window bounds between launches |
| **No keyboard shortcuts** | Power users forced to use mouse | Implement Cmd+K for search, Cmd+, for settings |

## "Looks Done But Isn't" Checklist

- [ ] **Tray Icon:** Often missing garbage collection prevention - verify tray variable is module-scoped
- [ ] **Tray Icon:** Often missing @2x asset - verify both 16x16 and 32x32@2x versions exist
- [ ] **Tray Icon:** Often wrong format for macOS - verify template image (black/white, alpha channel)
- [ ] **Search:** Often exact-match only - verify fuzzy matching works with typos
- [ ] **Search:** Often unranked results - verify most relevant results appear first
- [ ] **Search:** Often no debounce - verify typing doesn't trigger search on every keystroke
- [ ] **Launch:** Often missing `app.whenReady()` - verify all window creation is inside ready handler
- [ ] **Launch:** Often missing macOS event handlers - verify `open-file` registered before ready
- [ ] **UI:** Often web-style spacing - verify padding matches macOS conventions (12-16px)
- [ ] **UI:** Often missing dark mode - verify UI adapts when system theme changes
- [ ] **IPC:** Often missing type safety - verify preload exposes typed API, not `any`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **Tray disappears** | LOW - 5 min fix | Add module-level variable reference to tray |
| **Crash on launch** | MEDIUM - 30 min debug | Add `app.whenReady()` wrapper, check console for errors |
| **Grainy tray icon** | LOW - 15 min fix | Create @2x template image, verify naming convention |
| **Search too slow** | MEDIUM - 1 hour | Add debouncing, limit results, consider Web Worker |
| **Wrong search ranking** | MEDIUM - 1-2 hours | Tune Fuse.js weights and threshold, test with real queries |
| **UI feels non-native** | HIGH - multiple days | Audit against macOS HIG, update spacing/fonts/colors |
| **Security vulnerability** | HIGH - architectural | Disable nodeIntegration, implement contextBridge properly |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| **Tray GC issue** | ICON-01 | App runs 10+ minutes, tray still visible |
| **Template icon missing** | ICON-01 | Tray icon adapts to dark/light mode, sharp on Retina |
| **Crash on launch** | LAUNCH-01 | App launches successfully 10/10 times |
| **Window doesn't render** | LAUNCH-02 | Window shows content within 2 seconds of launch |
| **Exact match search** | SEARCH-01 | "mcpx" finds "mcpx-server", " MCPX", "mcp" |
| **Poor search ranking** | SEARCH-02 | Exact matches rank higher than fuzzy matches |
| **Non-native UI** | UI-01 | UI audit passes macOS HIG checklist |
| **Missing dark mode** | UI-02 | UI switches correctly when system theme changes |
| **Context isolation breakage** | LAUNCH-02 | All IPC calls work, no console errors |

## Sources

- Electron FAQ - "My app's tray disappeared after a few minutes" (GitHub)
- Electron Documentation - Tray API, macOS platform considerations
- Electron Documentation - App lifecycle and `ready` event
- Electron Documentation - Process model and context isolation
- Electron Documentation - Debugging main process crashes
- Fuse.js Documentation - Configuration options and scoring
- Apple Human Interface Guidelines - macOS Big Sur and later
- Electron GitHub Issues - Common crash patterns and solutions
- Community post-mortems - Electron app launch failures
- Project codebase analysis - `.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: Electron Desktop App Fixes (mcpx)*
*Researched: Mon Mar 09 2026 (v1.1 updates: Mon Mar 24 2026)*