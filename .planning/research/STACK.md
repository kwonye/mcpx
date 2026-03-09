# Technology Stack

**Project:** mcpx Desktop App Fixes
**Researched:** 2026-03-09

## Context

This is a **subsequent milestone** for an existing Electron + React application. The base stack is established (Electron 35.x, React 19.1.x, TypeScript 5.9.3, vanilla CSS). This research focuses on 2025 best practices for specific problem areas: crash debugging, fuzzy search, macOS HIG compliance, and tray icon implementation.

---

## Recommended Approaches

### 1. Debugging Electron App Crashes on Launch

| Technology/Tool | Purpose | Why |
|-----------------|---------|-----|
| VSCode Debugger | Main process debugging | Built-in support via V8 inspector protocol; no external tools needed |
| `--inspect-brk` flag | Pause on startup | Breaks on first line, catching initialization crashes before they occur |
| `ELECTRON_ENABLE_LOGGING=1` | Console logging | Enables Chromium logging to stderr for diagnosing startup failures |
| `crashReporter` API | Crash reporting | Uses Crashpad (not Breakpad) to capture and submit crash dumps |
| `webContents.openDevTools()` | Renderer debugging | Opens Chrome DevTools for renderer process issues |

**Recommended Debugging Workflow:**

```typescript
// 1. Add to app/src/main/index.ts (before app.whenReady())
import { crashReporter } from 'electron'

crashReporter.start({
  productName: 'mcpx',
  uploadToServer: false, // Store locally during development
  extra: { version: app.getVersion() }
})

// 2. Create .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/app",
      "runtimeExecutable": "${workspaceFolder}/app/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/app/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "env": {
        "ELECTRON_ENABLE_LOGGING": "true",
        "ELECTRON_ENABLE_STACK_DUMPING": "true"
      },
      "outputCapture": "std"
    }
  ]
}

// 3. Run with: code --inspect-brk=9229 app/
// 4. Connect via chrome://inspect or VSCode debugger
```

**Crash Diagnosis Checklist:**

1. Check if crash occurs in main process (terminal output) or renderer (DevTools console)
2. Enable `ELECTRON_ENABLE_LOGGING=1` environment variable
3. Use `--inspect-brk=9229` to pause on startup
4. Set breakpoints in `app.whenReady()` and IPC handlers
5. Check `crashReporter.getLastCrashReport()` for crash metadata
6. For renderer crashes: call `win.webContents.openDevTools()` immediately on window creation

**Common Launch Crash Causes:**

- Native module loading failures (check Node.js version compatibility)
- File system access before `app.whenReady()` completes
- Keychain access before app is ready
- Tray icon created before `ready` event (tray can only be instantiated after ready)
- Path resolution errors in `electron-vite` aliases

---

### 2. Fuzzy Search in React Applications

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Fuse.js** | 7.1.0 (Feb 2025) | Fuzzy search engine | Industry standard; 20k stars; zero dependencies; 96% JavaScript |
| **useFuse** (custom hook) | — | React integration | Wraps Fuse.js for idiomatic React usage with useMemo caching |

**Why Fuse.js:**

- **Zero dependencies** — No bloat, works in any environment
- **Client-side only** — No backend setup required (unlike ElasticSearch, Algolia)
- **Weighted search** — Support for nested keys and scoring
- **Small bundle** — ~6KB gzipped
- **Actively maintained** — v7.1.0 released February 2025

**Recommended Implementation:**

```typescript
// app/src/main/search-utils.ts (main process)
import Fuse from 'fuse.js'
import type { RegistryServer } from '@mcpx/core'

export interface SearchOptions {
  query: string
  items: RegistryServer[]
  keys?: (keyof RegistryServer)[]
}

export function searchServers(options: SearchOptions): RegistryServer[] {
  const { query, items, keys = ['name', 'description', 'author'] } = options
  
  const fuse = new Fuse(items, {
    keys,
    threshold: 0.4, // 0 = exact match, 1 = match anything
    includeScore: true,
    shouldSort: true,
    minMatchCharLength: 2,
    // Priority weighting
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'description', weight: 0.2 },
      { name: 'author', weight: 0.1 }
    ]
  })
  
  const results = fuse.search(query)
  return results.map(result => result.item)
}

// app/src/renderer/hooks/useFuseSearch.ts (renderer hook)
import { useMemo } from 'react'
import Fuse from 'fuse.js'

export function useFuseSearch<T>(
  items: T[],
  query: string,
  keys: (keyof T)[],
  options?: Fuse.IFuseOptions<T>
): T[] {
  return useMemo(() => {
    if (!query.trim()) return items
    
    const fuse = new Fuse(items, {
      keys,
      threshold: 0.4,
      includeScore: true,
      shouldSort: true,
      ...options
    })
    
    const results = fuse.search(query)
    return results.map(r => r.item)
  }, [items, query, keys, options])
}
```

**Usage in BrowseTab:**

```tsx
// app/src/renderer/components/BrowseTab.tsx
const { data: servers } = useRegistryList()
const [searchQuery, setSearchQuery] = useState('')

const filteredServers = useFuseSearch(
  servers || [],
  searchQuery,
  ['name', 'description', 'author'],
  {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'description', weight: 0.2 },
      { name: 'author', weight: 0.1 }
    ]
  }
)
```

**Alternative Considered:**

| Alternative | Why Not |
|-------------|---------|
| `fuzzaldrin-plus` | Less maintained, smaller community |
| `ts-fuzzy` | More complex API, larger bundle |
| Backend search (ElasticSearch) | Overkill for < 1000 items; adds infrastructure |

---

### 3. macOS Human Interface Guidelines for Electron Apps

**Key HIG Principles for Menu Bar Apps:**

| Guideline | Implementation | Why |
|-----------|---------------|-----|
| **Template Images** | Use `Template` suffix for tray icons | macOS auto-inverts for dark mode; required for menu bar extras |
| **Icon Sizes** | 16x16 @72dpi + 32x32 @144dpi (@2x) | Ensures crisp rendering on retina displays |
| **Menu Structure** | Follow macOS conventions (Quit last, preferences with ⌘,) | Users expect standard menu patterns |
| **Status Area Placement** | Top-right menu bar extras | macOS designates this area for utility apps |
| **Minimal UI** | Prefer system menus over custom windows | Reduces cognitive load; feels native |

**Tray Icon Requirements (from Electron docs):**

```typescript
// app/src/main/tray.ts
import { Tray, nativeImage, app } from 'electron'
import path from 'path'

// CRITICAL: Filename MUST end with "Template" for macOS
// CRITICAL: @2x variant must have same base name (no hashing!)
const trayIconPath = path.join(__dirname, '../../assets/icons/tray-iconTemplate.png')
const trayIcon2xPath = path.join(__dirname, '../../assets/icons/tray-iconTemplate@2x.png')

let tray: Tray | null = null

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(icon)
  
  tray.setToolTip('mcpx — MCP Server Manager')
  
  // macOS-specific: Set title next to icon (optional)
  if (process.platform === 'darwin') {
    // tray.setTitle('mcpx') // Only if needed; can clutter menu bar
  }
  
  return tray
}
```

**Icon Design Guidelines:**

1. **Use simple, monochromatic designs** — Template images ignore color; only alpha channel matters
2. **Avoid detail** — 16x16 is tiny; aim for recognizable silhouette
3. **Test in both light/dark modes** — Template images should work in both
4. **Provide @2x variant** — 32x32 at 144dpi for retina displays
5. **Don't hash filenames in build** — Webpack/Vite must preserve `Template` and `@2x` naming

**webpack/vite configuration (critical):**

```typescript
// app/electron.vite.config.ts
export default defineConfig({
  main: {
    // ... other config
    build: {
      rollupOptions: {
        output: {
          // DO NOT hash asset names for tray icons
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.includes('Template')) {
              return '[name][extname]' // Preserve original name
            }
            return '[name]-[hash][extname]'
          }
        }
      }
    }
  }
})
```

**Window Management (HIG Compliance):**

```typescript
// app/src/main/index.ts
app.on('window-all-closed', (e) => {
  // CRITICAL: Prevent app quit on macOS for menu bar apps
  // Users expect to close windows but keep app running in menu bar
  if (process.platform !== 'darwin') {
    app.quit()
  } else {
    e.preventDefault()
  }
})

app.on('activate', () => {
  // macOS: Re-create window when dock icon clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

---

### 4. Creating macOS Tray Icons

**Tray Icon Setup Pattern:**

```typescript
// app/src/main/tray-manager.ts
import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import path from 'path'

export class TrayManager {
  private tray: Tray | null = null
  private guid = 'com.kwonye.mcpx.tray' // Persistent positioning on macOS

  init(): void {
    app.whenReady().then(() => {
      // Template image (auto-inverts for dark mode)
      const icon = nativeImage.createFromPath(
        path.join(__dirname, '../../assets/icons/tray-iconTemplate.png')
      )
      
      this.tray = new Tray(icon, this.guid)
      
      this.setupContextMenu()
      this.setupEventHandlers()
    })
  }

  private setupContextMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open mcpx',
        click: () => this.showWindow()
      },
      {
        label: 'Status: Running',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Preferences...',
        accelerator: 'CmdOrCtrl+,',
        click: () => this.showPreferences()
      },
      { type: 'separator' },
      {
        label: 'Quit mcpx',
        accelerator: 'CmdOrCtrl+Q',
        click: () => app.quit()
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  private setupEventHandlers(): void {
    if (!this.tray) return

    // Left click: Toggle window visibility
    this.tray.on('click', () => {
      this.toggleWindow()
    })

    // Double click: Always open window
    this.tray.on('double-click', () => {
      this.showWindow()
    })
  }

  private showWindow(): void {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length === 0) {
      // Create new window if none exist
      // (handled by main process window manager)
      app.emit('activate')
    } else {
      wins[0].show()
      wins[0].focus()
    }
  }

  private toggleWindow(): void {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      if (wins[0].isVisible()) {
        wins[0].hide()
      } else {
        wins[0].show()
        wins[0].focus()
      }
    }
  }

  private showPreferences(): void {
    // Open preferences window or tab
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
```

**Critical macOS-Specific Considerations:**

| Concern | Solution | Why |
|---------|----------|-----|
| **Garbage collection** | Store Tray reference globally | Tray will disappear if GC collects it |
| **Template naming** | Filename must end in `Template` | macOS won't auto-invert otherwise |
| **@2x resolution** | Provide 32x32 @144dpi version | Prevents grainy icons on retina |
| **Webpack hashing** | Disable asset hashing for icons | `iconTemplate@2x.png` must match exactly |
| **Persistent position** | Use GUID in Tray constructor | Icon stays in same position across relaunches |
| **Menu bar extras** | Keep UI minimal; prefer menus | macOS designates top-right for utilities |

**Icon Asset Requirements:**

```
app/assets/icons/
  ├── tray-iconTemplate.png      # 16x16, 72dpi, PNG with alpha
  └── tray-iconTemplate@2x.png   # 32x32, 144dpi, PNG with alpha
```

**Template Image Format:**

- **Colors:** Ignore color — macOS renders as black (light mode) or white (dark mode)
- **Alpha:** Use alpha channel for transparency
- **Stroke:** 1-2pt stroke recommended for visibility
- **Design:** Simple silhouette; avoid fine detail

---

## Installation

```bash
# In app/ directory

# Fuse.js for fuzzy search
npm install fuse.js

# Types (if not bundled)
npm install -D @types/fuse.js
```

---

## Sources

| Source | Confidence | Notes |
|--------|------------|-------|
| [Electron Debugging Docs](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process) | HIGH | Official documentation |
| [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray) | HIGH | Official documentation |
| [Electron Tray Tutorial](https://www.electronjs.org/docs/latest/tutorial/tray) | HIGH | Official tutorial |
| [Electron Crash Reporter](https://www.electronjs.org/docs/latest/api/crash-reporter) | HIGH | Official documentation |
| [Electron VSCode Debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-vscode) | HIGH | Official tutorial |
| [Fuse.js Documentation](https://fusejs.io/) | HIGH | Official documentation |
| [Fuse.js GitHub](https://github.com/krisk/Fuse) | HIGH | 20k stars, v7.1.0 Feb 2025 |
| [Apple HIG Menu Bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar) | HIGH | Official Apple guidelines |
| [Apple HIG Icons](https://developer.apple.com/design/human-interface-guidelines/icons) | HIGH | Official Apple guidelines |

---

*Stack research: 2026-03-09*
