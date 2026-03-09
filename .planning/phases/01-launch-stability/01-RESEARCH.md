# Phase 1: Launch Stability - Research

**Researched:** 2026-03-09
**Domain:** Electron app lifecycle management, crash prevention, macOS integration
**Confidence:** HIGH

## Summary

Phase 1 focuses on ensuring the mcpx desktop app launches reliably on every attempt without crashes, renders full UI content (not blank screens), and properly handles macOS lifecycle events. The research reveals that the current codebase has the right structural foundation but may have timing issues around `app.whenReady()` usage and Electron API initialization order.

**Primary recommendation:** Wrap ALL Electron API calls (BrowserWindow, Tray, app methods) in `await app.whenReady()` guards, add crashReporter for diagnostics, and implement proper error boundaries with user-visible error states.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron | 35.x | Desktop app framework, IPC, window management | Existing stack, actively maintained, Chromium 134 base |
| React | 19.1.x | UI rendering in renderer process | Existing stack, component-based UI |
| TypeScript | 5.9.3 | Type safety across main/renderer processes | Existing stack, catches errors at compile time |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-vite | 3.x | Build tool with HMR for Electron | Existing stack, faster dev cycle than webpack |
| vitest | 4.x | Unit/component testing | Existing stack, fast parallel testing |
| @playwright/test | 1.58.x | E2E testing for Electron flows | Existing stack, reliable automation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-vite | electron-forge | More opinionated, but less flexible for custom builds |
| vanilla CSS | Tailwind CSS | Faster development, but adds bundle size and learning curve |

**Installation:**
```bash
cd app
npm install  # Already configured in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
app/src/main/
├── index.ts           # App bootstrap - MUST call app.whenReady() first
├── tray.ts            # Tray icon management (module-level reference)
├── dashboard.ts       # BrowserWindow creation and management
├── ipc-handlers.ts    # IPC bridge to renderer
├── daemon-child.ts    # Daemon child process mode
└── ...
```

### Pattern 1: app.whenReady() Guard for All Electron APIs
**What:** All Electron API calls (BrowserWindow, Tray, app.dock, etc.) must wait for the `ready` event
**When to use:** ALWAYS - this is mandatory for Electron stability
**Example:**
```typescript
// Source: https://www.electronjs.org/docs/latest/api/app#appwhenready
import { app, BrowserWindow } from "electron";

export async function openDashboard(): Promise<BrowserWindow> {
  await app.whenReady();  // CRITICAL: Wait for Electron initialization
  
  const dashboard = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  
  return dashboard;
}
```

### Pattern 2: Module-Level References for Tray
**What:** Hold Tray references at module level to prevent garbage collection
**When to use:** ALWAYS for tray icons - GC'd tray icons disappear from menu bar
**Example:**
```typescript
// Source: https://www.electronjs.org/docs/latest/api/tray
import { Tray, nativeImage } from "electron";

let tray: Tray | null = null;  // Module-level reference (prevents GC)

export function createTray(): Tray {
  if (tray) return tray;  // Singleton pattern
  
  const icon = nativeImage.createFromPath("path/to/iconTemplate.png");
  tray = new Tray(icon);  // Stored at module level
  return tray;
}
```

### Pattern 3: Crash Reporter for Diagnostics
**What:** Initialize crashReporter early to capture crash dumps
**When to use:** For production apps to diagnose startup crashes
**Example:**
```typescript
// Source: https://www.electronjs.org/docs/latest/api/crash-reporter
import { app, crashReporter } from "electron";

// MUST be called before app.whenReady() and any other Electron APIs
crashReporter.start({
  productName: "mcpx",
  uploadToServer: false,  // Store locally for debugging
  extra: {
    version: app.getVersion()
  }
});
```

### Anti-Patterns to Avoid
- **Creating BrowserWindow before app.whenReady():** Causes blank windows or crashes
- **Not holding Tray references:** Icon disappears after garbage collection
- **Calling Electron APIs in top-level scope:** Must wait for ready event
- **Ignoring window-all-closed on macOS:** App quits when window closes (wrong behavior)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Crash diagnostics | Custom error logging | Electron crashReporter | Built-in, captures native crashes, minidump format |
| Window lifecycle | Manual window tracking | BrowserWindow + app events | Electron manages renderer process lifecycle |
| Tray icon management | Custom menu bar implementation | Electron Tray API | Native macOS integration, automatic dark mode |
| Single instance lock | PID file checking | app.requestSingleInstanceLock() | Handles edge cases, cross-platform |

**Key insight:** Electron provides battle-tested abstractions for desktop app lifecycle. Custom implementations miss edge cases (GC, race conditions, platform differences).

## Common Pitfalls

### Pitfall 1: Creating Windows Before app.whenReady()
**What goes wrong:** BrowserWindow constructor called before Electron finishes initialization
**Why it happens:** Impatience or not understanding Electron's async initialization
**How to avoid:** 
```typescript
// WRONG: Top-level BrowserWindow creation
const win = new BrowserWindow({ width: 800, height: 600 });  // ❌

// CORRECT: Wait for ready event
await app.whenReady();
const win = new BrowserWindow({ width: 800, height: 600 });  // ✅
```
**Warning signs:** White/blank window on launch, intermittent crashes on startup

### Pitfall 2: Tray Icon Disappearing After GC
**What goes wrong:** Tray icon visible initially, then disappears after minutes
**Why it happens:** Tray reference stored in local scope, garbage collected
**How to avoid:**
```typescript
// WRONG: Local variable
function createTray() {
  const tray = new Tray(icon);  // ❌ GC'd when function returns
}

// CORRECT: Module-level variable
let tray: Tray | null = null;
tray = new Tray(icon);  // ✅ Persistent reference
```
**Warning signs:** Tray icon missing after app has been running, right-click shows nothing

### Pitfall 3: Not Handling macOS Lifecycle Events
**What goes wrong:** App quits when window closes, Cmd+Q doesn't work
**Why it happens:** Windows/Linux lifecycle patterns applied to macOS
**How to avoid:**
```typescript
// macOS: Hide app, don't quit
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();  // Only quit on non-macOS
  }
});

// macOS: Re-open window on dock click
app.on("activate", () => {
  openDashboard();  // Always create window on activate
});
```
**Warning signs:** App quits when closing window, dock click does nothing

### Pitfall 4: Async Initialization Race Conditions
**What goes wrong:** Daemon status check completes before app is ready
**Why it happens:** Promise chains not properly awaited
**How to avoid:**
```typescript
// WRONG: Fire and forget
maybeStartDaemonForLoginLaunch();  // ❌

// CORRECT: Proper async/await
await maybeStartDaemonForLoginLaunch();  // ✅
```
**Warning signs:** Intermittent startup failures, daemon not starting on login launch

## Code Examples

Verified patterns from official sources:

### Complete App Bootstrap Pattern
```typescript
// Source: https://www.electronjs.org/docs/latest/tutorial/process-model
import { app, BrowserWindow, crashReporter } from "electron";

// 1. Initialize crash reporter FIRST (before any Electron APIs)
crashReporter.start({
  productName: "mcpx",
  uploadToServer: false
});

// 2. Wait for app ready before ANY Electron API usage
await app.whenReady();

// 3. Now safe to create windows, tray, etc.
const win = new BrowserWindow({ /* options */ });
const tray = new Tray(icon);

// 4. Set up lifecycle handlers
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    openDashboard();
  }
});
```

### Error Handling with User Feedback
```typescript
// Source: Electron best practices
export async function startMainProcess(): Promise<void> {
  try {
    await app.whenReady();
    // ... initialization
  } catch (error) {
    console.error("[main] startup failed:", error);
    
    // Show error dialog to user
    const { dialog } = require("electron");
    await dialog.showErrorBox(
      "Startup Error",
      "mcpx failed to start: " + (error as Error).message
    );
    
    app.exit(1);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Synchronous app initialization | Async app.whenReady() | Electron 5+ | Prevents race conditions |
| Breakpad for crash reporting | Crashpad (built-in) | Electron 9+ | Better crash capture, automatic |
| Manual IPC serialization | contextBridge + IPC | Electron 12+ | Security isolation by default |
| Remote module for main process | Preload scripts only | Electron 14+ | Prevents security vulnerabilities |

**Deprecated/outdated:**
- `remote` module: Removed in Electron 14, use IPC instead
- `webContents.printToPDF()` without callback: Now returns Promise
- Callback-based Electron APIs: Most are now Promise-based

## Open Questions

1. **What specific crashes are occurring?**
   - What we know: App "crashes on startup" per STATE.md
   - What's unclear: Exact crash location, frequency, trigger conditions
   - Recommendation: Enable crashReporter, add console logging with timestamps

2. **Is the tray icon using template naming?**
   - What we know: Files are `trayIconTemplate.png` and `trayIconTemplate@2x.png`
   - What's unclear: Are they actually using macOS template format (black with alpha)?
   - Recommendation: Verify icon files are black PNGs with alpha channel

3. **Are there any native module initialization issues?**
   - What we know: @mcpx/core imports work in development
   - What's unclear: Any native dependencies that might fail on different macOS versions
   - Recommendation: Test on clean macOS installation, check for missing libraries

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (unit/component), Playwright 1.58.x (E2E) |
| Config file | `app/vitest.config.ts`, `app/playwright.config.ts` |
| Quick run command | `npm run test` (in app/) |
| Full suite command | `npm run test && npm run e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAUNCH-01 | App launches 10/10 times without crashing | E2E | `npm run e2e -- launch.spec.ts` | ❌ Wave 0 |
| LAUNCH-02 | Window renders full UI content (not blank) | E2E | `npm run e2e -- render.spec.ts` | ❌ Wave 0 |
| LAUNCH-03 | Window-close doesn't quit, reopen works | E2E | `npm run e2e -- lifecycle.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test` (Vitest suite)
- **Per wave merge:** `npm run test && npm run e2e` (full suite)
- **Phase gate:** All E2E tests green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `app/e2e/launch.spec.ts` — covers LAUNCH-01 (10 launch attempts)
- [ ] `app/e2e/render.spec.ts` — covers LAUNCH-02 (content visibility checks)
- [ ] `app/e2e/lifecycle.spec.ts` — covers LAUNCH-03 (window-close, activate)
- [ ] `app/test/main/lifecycle.test.ts` — unit tests for lifecycle handlers
- [ ] E2E test framework setup: `app/playwright.config.ts` exists but needs Electron-specific config

## Sources

### Primary (HIGH confidence)
- **Electron app API docs** - https://www.electronjs.org/docs/latest/api/app - Checked 2026-03-09 for `app.whenReady()`, lifecycle events
- **Electron Tray API** - https://www.electronjs.org/docs/latest/api/tray - Checked 2026-03-09 for GC prevention patterns
- **Electron crashReporter** - https://www.electronjs.org/docs/latest/api/crash-reporter - Checked 2026-03-09 for initialization order
- **Electron Process Model** - https://www.electronjs.org/docs/latest/tutorial/process-model - Checked 2026-03-09 for main/renderer architecture
- **mcpx codebase** - `app/src/main/index.ts`, `tray.ts`, `dashboard.ts` - Current implementation patterns

### Secondary (MEDIUM confidence)
- **Electron Tutorial: First App** - Common patterns for lifecycle management
- **mcpx AGENTS.md** - Project-specific conventions (vanilla CSS, ESM, zod validation)

### Tertiary (LOW confidence)
- **General Electron crash debugging patterns** - Marked for validation during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing project dependencies verified in package.json
- Architecture: HIGH - Electron official docs + current codebase analysis
- Pitfalls: HIGH - Common Electron issues well-documented in official sources

**Research date:** 2026-03-09
**Valid until:** 2026-06-09 (Electron 35 stable, patterns are mature)
