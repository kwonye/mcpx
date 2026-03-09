# Architecture Patterns

**Domain:** Electron Desktop App Fixes
**Researched:** 2026-03-09

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         macOS System Layer                               │
│  (Keychain, Login Items, Dock, Menu Bar)                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↑↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ index.ts    │  │ tray.ts      │  │ dashboard.ts │  │ ipc-handlers │ │
│  │ (lifecycle) │  │ (menu bar)   │  │ (window mgmt)│  │ (IPC bridge) │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ daemon-     │  │ registry-    │  │ search-      │  │ settings-    │ │
│  │ child.ts    │  │ client.ts    │  │ utils.ts     │  │ store.ts     │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↑↓ IPC
┌─────────────────────────────────────────────────────────────────────────┐
│                    Electron Preload Process                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ preload/index.ts (contextBridge: window.mcpx API)               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↑↓ window.mcpx
┌─────────────────────────────────────────────────────────────────────────┐
│                    React Renderer Process                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ App.tsx     │  │ Dashboard.tsx│  │ BrowseTab.tsx│  │ ServerCard   │ │
│  │ (root)      │  │ (layout)     │  │ (search UI)  │  │ (components) │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌─────────────┐  ┌──────────────┐                                      │
│  │ useMcpx.ts  │  │ index.css    │                                      │
│  │ (hooks)     │  │ (vanilla CSS)│                                      │
│  └─────────────┘  └──────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↑↓ @mcpx/core alias
┌─────────────────────────────────────────────────────────────────────────┐
│                      CLI Core Library                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ config.ts   │  │ daemon.ts    │  │ sync.ts      │  │ secrets.ts   │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ registry.ts │  │ adapters/    │  │ gateway/     │  │ paths.ts     │ │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↑↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      File System Layer                                   │
│  ~/.config/mcpx/config.json  |  ~/.local/share/mcpx/managed-index.json │
│  ~/Library/Application Support/mcpx/settings.json                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Boundaries

| Component | Responsibility | Communicates With | Fix Relevance |
|-----------|---------------|-------------------|---------------|
| `app/src/main/index.ts` | App bootstrap, lifecycle, single-instance lock, daemon auto-start | tray.ts, dashboard.ts, ipc-handlers.ts, @mcpx/core | **Crash fix** - initialization sequence |
| `app/src/main/tray.ts` | Menu bar icon, context menu, tooltip updates | dashboard.ts, Electron Tray API | **Tray icon** - icon asset loading |
| `app/src/main/dashboard.ts` | BrowserWindow creation, window management | Electron BrowserWindow API | **Crash fix** - window initialization |
| `app/src/main/ipc-handlers.ts` | IPC bridge, wraps @mcpx/core for renderer | preload/index.ts, @mcpx/core, registry-client.ts | All fixes - data flow |
| `app/src/main/search-utils.ts` | Client-side search filtering and relevance scoring | registry-client.ts | **Search** - filtering logic |
| `app/src/main/registry-client.ts` | MCP Registry API client, applies search utils | External registry API | **Search** - server-side + client-side |
| `app/src/preload/index.ts` | Context bridge, exposes window.mcpx API | ipcMain, renderer | All fixes - security boundary |
| `app/src/renderer/App.tsx` | Root component, view routing (popover vs dashboard) | Dashboard.tsx, StatusPopover.tsx | **Crash fix** - initial render |
| `app/src/renderer/Dashboard.tsx` | Main layout, tab navigation, server list | BrowseTab.tsx, ServerCard.tsx, useMcpx.ts | **UI polish** - layout structure |
| `app/src/renderer/BrowseTab.tsx` | Registry browse UI, search input, category pills | useRegistryList hook, AddServerForm.tsx | **Search** - UI integration |
| `app/src/renderer/hooks/useMcpx.ts` | Custom hooks (useStatus, useRegistryList) | window.mcpx API | **Search** - state management |
| `app/src/renderer/index.css` | Global styles, CSS variables, component styling | All renderer components | **UI polish** - styling |
| `cli/src/core/*` | Shared business logic (config, daemon, sync, secrets) | File system, macOS Keychain | All fixes - backend logic |

## Data Flow

### 1. App Launch Sequence (Crash Fix Context)

```
1. Electron loads app/src/main/index.ts
2. runDaemonChildIfRequested() checks MCPX_DAEMON_CHILD=1 env
3. app.requestSingleInstanceLock() prevents multiple instances
4. app.whenReady() waits for Electron initialization
5. loadDesktopSettings() reads settings.json
6. createTray() initializes menu bar icon
   → Loads trayIconTemplate.png from resources/
7. registerIpcHandlers() sets up IPC listeners
8. getDaemonStatus() checks if daemon was previously running
9. maybeStartDaemonForLoginLaunch() auto-starts if needed
10. Dashboard window opens on user interaction

CRASH POINTS:
- Step 3: Single-instance lock failure → app.quit()
- Step 6: Missing icon file → tray creation fails
- Step 8: Corrupt config.json → loadConfig() throws
- Step 10: BrowserWindow creation → renderer fails to load
```

### 2. Search Flow (Search Fix Context)

```
User types in BrowseTab search input
         ↓
BrowseTab.tsx handleSearch() → setActiveQuery() + search()
         ↓
useRegistryList hook → window.mcpx.registryList(undefined, query, limit)
         ↓
preload/index.ts → ipcRenderer.invoke(IPC.REGISTRY_LIST, ...)
         ↓
ipc-handlers.ts → fetchRegistryServers(cursor, query, limit)
         ↓
registry-client.ts fetchRegistryServers():
  ├─ Builds URL: https://registry.modelcontextprotocol.io/v0.1/servers?search=<query>
  ├─ Fetches from registry API
  ├─ Calls filterServersByQuery() (search-utils.ts)
  └─ Calls sortServersByRelevance() (search-utils.ts)
         ↓
Returns sorted/filtered results to renderer
         ↓
useRegistryList updates state → BrowseTab re-renders

CURRENT ISSUE: Only exact substring matches (includes())
FIX NEEDED: Fuzzy matching algorithm + better ranking
```

### 3. UI Rendering Flow (UI Polish Context)

```
Dashboard.tsx renders based on tab state
         ↓
Tab = "servers" → ServerCard grid + DaemonControls + CliCommandInput
Tab = "browse"  → BrowseTab (search + category pills + results)
Tab = "settings" → SettingsPanel
         ↓
Each component uses vanilla CSS from index.css
         ↓
CSS variables define theme (--bg-dark, --accent-primary, etc.)
         ↓
Components reference classes (.server-card, .browse-card, etc.)

POLISH AREAS:
- Spacing consistency (padding/margin)
- Typography hierarchy (font-size, font-weight)
- Color contrast (text-secondary vs text-primary)
- Hover states and transitions
- macOS native feel (rounded corners, shadows)
```

### 4. Tray Icon Flow (Icon Fix Context)

```
createTray() called from main/index.ts
         ↓
nativeImage.createFromPath(join(__dirname, "../../resources/trayIconTemplate.png"))
         ↓
new Tray(icon) creates macOS menu bar item
         ↓
tray.setToolTip("mcpx") sets hover text
         ↓
tray.setContextMenu(buildContextMenu(daemonRunning))
         ↓
User clicks tray → openDashboard()
User right-clicks → popUpContextMenu()

ICON ISSUE:
- Current: trayIconTemplate.png (98 bytes) - likely placeholder
- Needed: Proper macOS menu bar icon (template image, 18x18 @1x, 36x36 @2x)
- macOS requirement: Template images use alpha channel + system colors
```

## Patterns to Follow

### Pattern 1: IPC Handler Registration
**What:** Centralized IPC handler registration in `ipc-handlers.ts`
**When:** Adding new main↔renderer communication channels
**Example:**
```typescript
// app/src/main/ipc-handlers.ts
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.REGISTRY_LIST, (_event, cursor?: string, query?: string, limit?: number) => {
    return fetchRegistryServers(cursor, query, limit);
  });
}

// app/src/preload/index.ts
const api = {
  registryList: (cursor?: string, query?: string, limit?: number) => 
    ipcRenderer.invoke(IPC.REGISTRY_LIST, cursor ?? null, query ?? null, limit ?? null)
};

// app/src/renderer/hooks/useMcpx.ts
const result = await window.mcpx.registryList(undefined, normalizedQuery, limit);
```

### Pattern 2: CSS Variable Theming
**What:** Global CSS variables for consistent theming
**When:** Styling any component
**Example:**
```css
/* app/src/renderer/index.css */
:root {
  --bg-dark: #0f1115;
  --bg-card: #1a1d24;
  --accent-primary: #3b82f6;
  --radius-md: 12px;
}

.server-card {
  background-color: var(--bg-card);
  border-radius: var(--radius-md);
}
```

### Pattern 3: Daemon Lifecycle Management
**What:** Daemon state tracked in main process, exposed via IPC
**When:** Starting/stopping/restarting the gateway
**Example:**
```typescript
// app/src/main/index.ts
let daemonRunning = false;

async function handleStartDaemon(): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  await startDaemon(config, daemonEntrypointArg(), secrets);
  daemonRunning = true;
  updateTrayForDaemonStatus(true);
}
```

### Pattern 4: Client-Side Search with Relevance Scoring
**What:** Fetch all results, filter/sort client-side for better UX
**When:** Implementing search with ranking
**Current Implementation:**
```typescript
// app/src/main/search-utils.ts
export function calculateRelevanceScore(server: RegistryServerEntry, query: string): number {
  let score = 0;
  const searchText = query.toLowerCase();
  
  // Exact name match = highest priority
  if (nameLower === searchText) score += 100;
  // Starts with = high priority
  else if (nameLower.startsWith(searchText)) score += 50;
  // Contains = medium priority
  else if (nameLower.includes(searchText)) score += 30;
  
  return score;
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct Core Imports in Renderer
**What:** Importing @mcpx/core directly in renderer components
**Why bad:** Breaks Electron security model, renderer should only use IPC
**Instead:** Use window.mcpx API via preload bridge

### Anti-Pattern 2: Heavy CSS Frameworks
**What:** Adding Tailwind, Bootstrap, or CSS-in-JS libraries
**Why bad:** Bloats bundle, conflicts with existing vanilla CSS patterns
**Instead:** Extend index.css with component-specific classes

### Anti-Pattern 3: Synchronous File I/O in Main Process
**What:** Using fs.readFileSync during app initialization
**Why bad:** Blocks main process, causes perceived crashes
**Instead:** Use async file operations or preload configs

### Anti-Pattern 4: Hardcoded Paths
**What:** Using absolute or relative paths directly
**Why bad:** Breaks across environments (dev vs production)
**Instead:** Use join(__dirname, ...) or @mcpx/core paths.ts

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Registry search | Client-side filtering fine | Consider server-side filtering | Dedicated search API |
| Config file size | JSON file works | JSON still fine | Consider indexed DB |
| Icon assets | 2x templates sufficient | Add @3x for retina | Multi-resolution set |
| IPC channels | ~15 handlers OK | May need batching | Consider event streaming |

## Fix-Specific Architecture Impact

### 1. Crash Fix
**Affected files:**
- `app/src/main/index.ts` - initialization sequence
- `app/src/main/dashboard.ts` - window creation
- `app/src/main/tray.ts` - icon loading

**Architecture constraints:**
- Must maintain @mcpx/core integration
- Cannot remove single-instance lock pattern
- Must preserve daemon auto-start for login items

**Safe modification points:**
- Error handling around tray creation
- Fallback for missing icon assets
- Graceful degradation if config is corrupt

### 2. Search Fix
**Affected files:**
- `app/src/main/search-utils.ts` - filtering/ranking logic
- `app/src/main/registry-client.ts` - API integration
- `app/src/renderer/BrowseTab.tsx` - search UI

**Architecture constraints:**
- Must work with existing registry API (server-side search)
- Client-side filtering is fallback/enhancement
- Maintain relevance scoring for ranking

**Safe modification points:**
- Replace `includes()` with fuzzy match algorithm
- Enhance `calculateRelevanceScore()` with additional signals
- Add debouncing in useRegistryList hook

### 3. UI Polish
**Affected files:**
- `app/src/renderer/index.css` - all styling
- Component files - class references

**Architecture constraints:**
- Must use vanilla CSS (no frameworks)
- Preserve CSS variable theming
- Maintain dark mode palette

**Safe modification points:**
- Adjust CSS variable values
- Refine spacing/typography
- Add missing hover states
- Improve component alignment

### 4. Tray Icon
**Affected files:**
- `app/resources/trayIconTemplate.png` - icon asset
- `app/resources/trayIconTemplate@2x.png` - retina asset
- `app/src/main/tray.ts` - icon loading (minimal changes)

**Architecture constraints:**
- macOS template image format (alpha + system colors)
- 18x18 @1x, 36x36 @2x recommended sizes
- File naming convention: trayIconTemplate.png

**Safe modification points:**
- Replace PNG assets with properly designed icons
- No code changes needed if naming preserved

---

*Architecture analysis: 2026-03-09*
