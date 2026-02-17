# mcpx Desktop App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a macOS Electron desktop app alongside the existing CLI in a monorepo, providing visual status monitoring, server management, and one-click MCP server installation from the official MCP Registry.

**Architecture:** Monorepo with `cli/` (existing code, moved) and `app/` (new Electron app). The app imports core modules directly from the CLI package via TypeScript path aliases. The Electron main process bridges core functions to the React renderer via IPC.

**Tech Stack:** Electron, electron-vite, React, TypeScript, vitest, React Testing Library, Playwright

---

## Phase 1: Repo Restructure

### Task 1: Move CLI code to `cli/` directory

**Files:**
- Move: all of `src/`, `test/`, `scripts/`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` (if exists) → `cli/`
- Keep at root: `.gitignore`, `.github/`, `README.md`, `CLAUDE.md`, `docs/`, `LICENSE`

**Step 1: Create `cli/` and move files**

```bash
mkdir cli
git mv src cli/src
git mv test cli/test
git mv scripts cli/scripts
git mv package.json cli/package.json
git mv package-lock.json cli/package-lock.json
git mv tsconfig.json cli/tsconfig.json
```

Also move any other CLI-specific root files (`.npmrc`, `vitest.config.ts`, etc.) if they exist.

**Step 2: Update `cli/package.json` paths**

The `bin`, `scripts`, and `files` entries reference relative paths that are now correct since package.json moved with them. Verify:
- `"bin": { "mcpx": "dist/cli.js" }` — still correct (dist/ is relative to cli/)
- `"scripts.dev": "tsx src/cli.ts"` — still correct
- `"scripts.build": "tsc -p tsconfig.json"` — still correct

**Step 3: Update `cli/scripts/sync-version.mjs`**

The script uses `import.meta.dirname` to find repo root. Since it moved into `cli/scripts/`, `resolve(import.meta.dirname, "..")` now points to `cli/`, which is correct for finding `cli/package.json` and `cli/src/version.ts`.

No change needed.

**Step 4: Update `.github/workflows/release.yml`**

All `npm` commands need to run inside `cli/`:

```yaml
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: cli/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: cli

      - name: Build
        run: npm run build
        working-directory: cli

      - name: Test
        run: npm test
        working-directory: cli

      # ... rest of steps also need working-directory: cli
      # Except git operations which stay at repo root
```

For git commit/push/tag steps, those operate on the repo root — no `working-directory` needed. But `npm version`, `npm run sync-version`, `npm publish` all need `working-directory: cli`.

**Step 5: Install deps and verify**

```bash
cd cli && npm install && npm run build && npm test
```

Expected: all tests pass, build succeeds.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move CLI code to cli/ directory for monorepo structure"
```

---

### Task 2: Add core barrel export

**Files:**
- Create: `cli/src/core/index.ts`
- Modify: `cli/package.json` (add exports map)

**Step 1: Create `cli/src/core/index.ts`**

This barrel file exports the public API that both CLI and desktop app consume:

```typescript
// Config
export { loadConfig, saveConfig, defaultConfig } from "./config.js";

// Status
export { buildStatusReport, STATUS_CLIENTS } from "./status.js";
export type { StatusReport, StatusServerEntry, StatusClientMapping, StatusAuthBinding } from "./status.js";

// Daemon
export { getDaemonStatus, startDaemon, stopDaemon, restartDaemon, readDaemonLogs } from "./daemon.js";
export type { DaemonStatus } from "./daemon.js";

// Sync
export { syncAllClients, getGatewayUrl } from "./sync.js";

// Registry (server add/remove)
export { addServer, removeServer } from "./registry.js";

// Secrets
export { SecretsManager } from "./secrets.js";

// Server Auth
export {
  applyAuthReference,
  removeAuthReference,
  listAuthBindings,
  resolveAuthTarget,
  defaultAuthSecretName,
  maybePrefixBearer,
  secretRefName,
  toSecretRef
} from "./server-auth.js";

// Auth Probe
export { probeHttpAuthRequirement } from "./auth-probe.js";
export type { HttpAuthProbeResult } from "./auth-probe.js";

// Managed Index
export { loadManagedIndex } from "./managed-index.js";

// Paths
export { getConfigPath, getManagedIndexPath } from "./paths.js";

// Types (re-export from parent)
export type {
  McpxConfig,
  ClientId,
  ClientStatus,
  UpstreamServerSpec,
  HttpServerSpec,
  StdioServerSpec,
  GatewayConfig,
  ClientSyncState,
  ManagedIndex,
  ManagedEntry,
  ManagedClientState,
  SyncResult,
  ManagedGatewayEntry
} from "../types.js";
```

**Step 2: Add exports map to `cli/package.json`**

Add the `"exports"` field:

```json
{
  "exports": {
    ".": "./dist/cli.js",
    "./core": "./dist/core/index.js",
    "./types": "./dist/types.js"
  }
}
```

**Step 3: Build and verify**

```bash
cd cli && npm run build
```

Expected: `cli/dist/core/index.js` and `cli/dist/core/index.d.ts` are generated.

**Step 4: Verify existing tests still pass**

```bash
cd cli && npm test
```

Expected: all tests pass (barrel export doesn't affect anything).

**Step 5: Commit**

```bash
git add cli/src/core/index.ts cli/package.json
git commit -m "feat: add core barrel export and package exports map"
```

---

## Phase 2: Electron App Scaffold

### Task 3: Initialize Electron app

**Files:**
- Create: `app/package.json`
- Create: `app/electron.vite.config.ts`
- Create: `app/tsconfig.json`
- Create: `app/tsconfig.node.json`
- Create: `app/tsconfig.web.json`
- Create: `app/src/main/index.ts`
- Create: `app/src/renderer/index.html`
- Create: `app/src/renderer/main.tsx`
- Create: `app/src/renderer/App.tsx`

**Step 1: Create `app/package.json`**

```json
{
  "name": "mcpx-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "mcpx desktop app",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "electron": "^35.0.0",
    "electron-vite": "^3.1.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create `app/electron.vite.config.ts`**

```typescript
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@mcpx/core": resolve(__dirname, "../cli/src/core/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
```

**Step 3: Create TypeScript configs**

`app/tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

`app/tsconfig.node.json` (main process):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "outDir": "out/main",
    "rootDir": "src/main",
    "paths": {
      "@mcpx/core": ["../cli/src/core/index.ts"]
    }
  },
  "include": ["src/main/**/*.ts"]
}
```

`app/tsconfig.web.json` (renderer):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "out/renderer",
    "rootDir": "src/renderer",
    "paths": {
      "@renderer/*": ["./src/renderer/*"]
    }
  },
  "include": ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"]
}
```

**Step 4: Create main process entry**

`app/src/main/index.ts`:
```typescript
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

**Step 5: Create renderer entry**

`app/src/renderer/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>mcpx</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

`app/src/renderer/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
```

`app/src/renderer/App.tsx`:
```tsx
export function App(): JSX.Element {
  return <div>mcpx desktop</div>;
}
```

**Step 6: Install and verify**

```bash
cd app && npm install && npm run build
```

Expected: builds without errors, `out/` directory created.

**Step 7: Verify app launches**

```bash
cd app && npm run dev
```

Expected: Electron window opens showing "mcpx desktop". Kill with Ctrl+C.

**Step 8: Commit**

```bash
git add app/
git commit -m "feat: scaffold Electron app with electron-vite and React"
```

---

### Task 4: Add preload script and IPC types

**Files:**
- Create: `app/src/preload/index.ts`
- Create: `app/src/shared/ipc-channels.ts`

**Step 1: Define IPC channel names**

`app/src/shared/ipc-channels.ts`:
```typescript
export const IPC = {
  GET_STATUS: "mcpx:get-status",
  GET_SERVERS: "mcpx:get-servers",
  ADD_SERVER: "mcpx:add-server",
  REMOVE_SERVER: "mcpx:remove-server",
  SYNC_ALL: "mcpx:sync-all",
  DAEMON_START: "mcpx:daemon-start",
  DAEMON_STOP: "mcpx:daemon-stop",
  DAEMON_RESTART: "mcpx:daemon-restart",
  REGISTRY_LIST: "mcpx:registry-list",
  REGISTRY_GET: "mcpx:registry-get"
} as const;
```

**Step 2: Create preload script**

`app/src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";

const api = {
  getStatus: () => ipcRenderer.invoke(IPC.GET_STATUS),
  getServers: () => ipcRenderer.invoke(IPC.GET_SERVERS),
  addServer: (name: string, spec: unknown) => ipcRenderer.invoke(IPC.ADD_SERVER, name, spec),
  removeServer: (name: string) => ipcRenderer.invoke(IPC.REMOVE_SERVER, name),
  syncAll: () => ipcRenderer.invoke(IPC.SYNC_ALL),
  daemonStart: () => ipcRenderer.invoke(IPC.DAEMON_START),
  daemonStop: () => ipcRenderer.invoke(IPC.DAEMON_STOP),
  daemonRestart: () => ipcRenderer.invoke(IPC.DAEMON_RESTART),
  registryList: (cursor?: string, query?: string) => ipcRenderer.invoke(IPC.REGISTRY_LIST, cursor, query),
  registryGet: (name: string) => ipcRenderer.invoke(IPC.REGISTRY_GET, name)
};

contextBridge.exposeInMainWorld("mcpx", api);

export type McpxApi = typeof api;
```

**Step 3: Add preload config to `app/electron.vite.config.ts`**

The preload section should resolve the shared types:
```typescript
preload: {
  plugins: [externalizeDepsPlugin()],
  build: {
    rollupOptions: {
      input: resolve(__dirname, "src/preload/index.ts")
    }
  }
}
```

**Step 4: Add type declaration for renderer**

Create `app/src/renderer/env.d.ts`:
```typescript
import type { McpxApi } from "../preload/index";

declare global {
  interface Window {
    mcpx: McpxApi;
  }
}
```

**Step 5: Build and verify**

```bash
cd app && npm run build
```

Expected: builds without errors, `out/preload/index.js` exists.

**Step 6: Commit**

```bash
git add app/src/preload/ app/src/shared/ app/src/renderer/env.d.ts app/electron.vite.config.ts
git commit -m "feat: add preload script and IPC channel types"
```

---

## Phase 3: IPC Bridge + Core Integration

### Task 5: IPC handlers connecting to core modules

**Files:**
- Create: `app/src/main/ipc-handlers.ts`
- Modify: `app/src/main/index.ts`

**Step 1: Write test for IPC handler module**

Create `app/test/ipc-handlers.test.ts`. Since IPC handlers call core module functions, test the handler logic by mocking the core imports:

```typescript
import { describe, expect, it, vi } from "vitest";

// Test the core module integration indirectly — verify the handler
// functions call the right core functions with the right args.
// Full IPC wiring is tested in E2E.

describe("ipc handler logic", () => {
  it("placeholder for handler unit tests", () => {
    expect(true).toBe(true);
  });
});
```

Note: The real value of IPC handler tests comes after implementing each handler. Add tests incrementally as handlers are built in later tasks. E2E tests cover the full IPC round-trip.

**Step 2: Create `app/src/main/ipc-handlers.ts`**

```typescript
import { ipcMain } from "electron";
import {
  loadConfig,
  saveConfig,
  buildStatusReport,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  syncAllClients,
  addServer,
  removeServer,
  loadManagedIndex,
  SecretsManager
} from "@mcpx/core";
import type { UpstreamServerSpec } from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.GET_STATUS, () => {
    const config = loadConfig();
    const managedIndex = loadManagedIndex();
    const daemon = getDaemonStatus(config);
    return buildStatusReport(config, managedIndex, daemon);
  });

  ipcMain.handle(IPC.GET_SERVERS, () => {
    const config = loadConfig();
    return Object.entries(config.servers).map(([name, spec]) => ({ name, ...spec }));
  });

  ipcMain.handle(IPC.ADD_SERVER, (_event, name: string, spec: UpstreamServerSpec) => {
    const config = loadConfig();
    addServer(config, name, spec, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { added: name, sync: summary };
  });

  ipcMain.handle(IPC.REMOVE_SERVER, (_event, name: string) => {
    const config = loadConfig();
    removeServer(config, name, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { removed: name, sync: summary };
  });

  ipcMain.handle(IPC.SYNC_ALL, () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return syncAllClients(config, secrets);
  });

  ipcMain.handle(IPC.DAEMON_START, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return startDaemon(config, process.execPath, secrets);
  });

  ipcMain.handle(IPC.DAEMON_STOP, () => {
    return stopDaemon();
  });

  ipcMain.handle(IPC.DAEMON_RESTART, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return restartDaemon(config, process.execPath, secrets);
  });
}
```

**Step 3: Wire handlers into main process**

Update `app/src/main/index.ts` to call `registerIpcHandlers()` in `app.whenReady()`.

**Step 4: Build and verify**

```bash
cd app && npm run build
```

Expected: builds without errors, core module imports resolve via alias.

**Step 5: Commit**

```bash
git add app/src/main/ipc-handlers.ts app/src/main/index.ts app/test/
git commit -m "feat: add IPC handlers bridging core modules to renderer"
```

---

## Phase 4: Tray + Windows

### Task 6: Menubar tray icon and popover window

**Files:**
- Create: `app/src/main/tray.ts`
- Create: `app/resources/trayIconTemplate.png` (and `@2x` variant)
- Modify: `app/src/main/index.ts`

**Step 1: Create tray module**

`app/src/main/tray.ts`:
```typescript
import { Tray, BrowserWindow, nativeImage, screen } from "electron";
import { join } from "node:path";

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;

function createPopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#popover`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { hash: "popover" });
  }

  win.on("blur", () => win.hide());

  return win;
}

function positionPopoverNearTray(trayBounds: Electron.Rectangle, win: BrowserWindow): void {
  const { width, height } = win.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = trayBounds.y + trayBounds.height;
  win.setBounds({ x, y, width, height });
}

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/trayIconTemplate.png")
  );
  tray = new Tray(icon);
  tray.setToolTip("mcpx");

  tray.on("click", () => {
    if (!popover) {
      popover = createPopoverWindow();
    }

    if (popover.isVisible()) {
      popover.hide();
    } else {
      const bounds = tray!.getBounds();
      positionPopoverNearTray(bounds, popover);
      popover.show();
      popover.focus();
    }
  });

  return tray;
}
```

For the tray icon: create a simple 16x16 (and 32x32 @2x) PNG template image. On macOS, naming it `*Template.png` makes it adapt to dark/light mode automatically. Use a simple "M" or gateway icon. This can be a placeholder initially.

**Step 2: Create dashboard window module**

`app/src/main/dashboard.ts`:
```typescript
import { BrowserWindow } from "electron";
import { join } from "node:path";

let dashboard: BrowserWindow | null = null;

export function openDashboard(): BrowserWindow {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.focus();
    return dashboard;
  }

  dashboard = new BrowserWindow({
    width: 900,
    height: 650,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    dashboard.loadURL(`${process.env.ELECTRON_RENDERER_URL}#dashboard`);
  } else {
    dashboard.loadFile(join(__dirname, "../renderer/index.html"), { hash: "dashboard" });
  }

  dashboard.on("closed", () => {
    dashboard = null;
  });

  return dashboard;
}
```

**Step 3: Add IPC for opening dashboard**

Add to `app/src/shared/ipc-channels.ts`:
```typescript
OPEN_DASHBOARD: "mcpx:open-dashboard"
```

Add handler in `ipc-handlers.ts`:
```typescript
import { openDashboard } from "./dashboard";

ipcMain.handle(IPC.OPEN_DASHBOARD, () => {
  openDashboard();
});
```

Add to preload:
```typescript
openDashboard: () => ipcRenderer.invoke(IPC.OPEN_DASHBOARD)
```

**Step 4: Update main entry to use tray instead of direct window**

Replace the `createWindow()` call in `app/src/main/index.ts`:

```typescript
import { app } from "electron";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc-handlers";

app.dock?.hide(); // Hide dock icon — menubar app

app.whenReady().then(() => {
  registerIpcHandlers();
  createTray();
});
```

**Step 5: Build and verify**

```bash
cd app && npm run build && npm run dev
```

Expected: tray icon appears in menubar, clicking shows popover. No dock icon.

**Step 6: Commit**

```bash
git add app/src/main/ app/resources/ app/src/shared/
git commit -m "feat: add menubar tray icon with popover and dashboard windows"
```

---

## Phase 5: Renderer UI

### Task 7: App shell with hash routing

**Files:**
- Modify: `app/src/renderer/App.tsx`
- Create: `app/src/renderer/hooks/useMcpx.ts`

**Step 1: Set up hash-based routing**

The popover and dashboard are the same renderer loaded with different hashes. `App.tsx` switches on hash:

```tsx
import { useEffect, useState } from "react";
import { StatusPopover } from "./components/StatusPopover";
import { Dashboard } from "./components/Dashboard";

export function App(): JSX.Element {
  const [view, setView] = useState<"popover" | "dashboard">("dashboard");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "popover") {
      setView("popover");
    }
  }, []);

  if (view === "popover") {
    return <StatusPopover />;
  }

  return <Dashboard />;
}
```

**Step 2: Create IPC hooks**

`app/src/renderer/hooks/useMcpx.ts`:
```tsx
import { useCallback, useEffect, useState } from "react";

export function useStatus() {
  const [status, setStatus] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await window.mcpx.getStatus();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, refresh };
}

export function useRegistryList() {
  const [servers, setServers] = useState<unknown[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query?: string) => {
    setLoading(true);
    const result = await window.mcpx.registryList(undefined, query);
    setServers(result.servers ?? []);
    setCursor(result.metadata?.nextCursor ?? undefined);
    setLoading(false);
  }, []);

  const loadMore = useCallback(async (query?: string) => {
    if (!cursor) return;
    setLoading(true);
    const result = await window.mcpx.registryList(cursor, query);
    setServers((prev) => [...prev, ...(result.servers ?? [])]);
    setCursor(result.metadata?.nextCursor ?? undefined);
    setLoading(false);
  }, [cursor]);

  return { servers, loading, search, loadMore, hasMore: Boolean(cursor) };
}
```

**Step 3: Commit**

```bash
git add app/src/renderer/
git commit -m "feat: add app shell with hash routing and IPC hooks"
```

---

### Task 8: StatusPopover component

**Files:**
- Create: `app/src/renderer/components/StatusPopover.tsx`
- Create: `app/test/components/StatusPopover.test.tsx`

**Step 1: Write component test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPopover } from "../../src/renderer/components/StatusPopover";

// Mock window.mcpx
const mockMcpx = {
  getStatus: vi.fn().mockResolvedValue({
    daemon: { running: true, pid: 1234, port: 37373 },
    upstreamCount: 3,
    servers: [
      { name: "vercel", clients: [{ status: "ERROR", managed: true }] },
      { name: "github", clients: [{ status: "SYNCED", managed: true }] }
    ]
  }),
  syncAll: vi.fn(),
  daemonRestart: vi.fn(),
  openDashboard: vi.fn()
};

Object.defineProperty(window, "mcpx", { value: mockMcpx });

describe("StatusPopover", () => {
  it("shows daemon status when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/running/i)).toBeDefined();
    expect(await screen.findByText(/37373/)).toBeDefined();
  });

  it("shows server count", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/3 servers/i)).toBeDefined();
  });

  it("shows error count when errors exist", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/1 error/i)).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run test/components/StatusPopover.test.tsx
```

Expected: FAIL — component doesn't exist yet.

**Step 3: Implement component**

`app/src/renderer/components/StatusPopover.tsx`:
```tsx
import { useStatus } from "../hooks/useMcpx";

export function StatusPopover(): JSX.Element {
  const { status, loading } = useStatus();

  if (loading || !status) {
    return <div className="popover">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    upstreamCount: number;
    servers: Array<{ name: string; clients: Array<{ status: string; managed: boolean }> }>;
  };

  const errorCount = report.servers.reduce((count, server) => {
    return count + server.clients.filter((c) => c.managed && c.status === "ERROR").length;
  }, 0);

  const syncedCount = report.servers.reduce((count, server) => {
    return count + server.clients.filter((c) => c.managed && c.status === "SYNCED").length;
  }, 0);

  return (
    <div className="popover">
      <div className="popover-status">
        {report.daemon.running
          ? `Gateway running on :${report.daemon.port}`
          : "Gateway stopped"}
      </div>
      <div className="popover-summary">
        {report.upstreamCount} servers · {syncedCount} synced
        {errorCount > 0 && ` · ${errorCount} error${errorCount > 1 ? "s" : ""}`}
      </div>
      <div className="popover-actions">
        <button onClick={() => window.mcpx.openDashboard()}>Open Dashboard</button>
        <button onClick={() => window.mcpx.syncAll()}>Sync All</button>
        <button onClick={() => window.mcpx.daemonRestart()}>Restart</button>
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run test/components/StatusPopover.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/src/renderer/components/StatusPopover.tsx app/test/components/
git commit -m "feat: add StatusPopover component with tests"
```

---

### Task 9: Dashboard with server list and ServerCard

**Files:**
- Create: `app/src/renderer/components/Dashboard.tsx`
- Create: `app/src/renderer/components/ServerCard.tsx`
- Create: `app/test/components/ServerCard.test.tsx`
- Create: `app/test/components/Dashboard.test.tsx`

**Step 1: Write ServerCard test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServerCard } from "../../src/renderer/components/ServerCard";

describe("ServerCard", () => {
  it("renders server name and transport", () => {
    render(
      <ServerCard
        name="vercel"
        transport="http"
        target="https://mcp.vercel.com"
        authConfigured={true}
        syncedCount={3}
        errorCount={0}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("vercel")).toBeDefined();
    expect(screen.getByText(/http/i)).toBeDefined();
  });

  it("shows error indicator when errors exist", () => {
    render(
      <ServerCard
        name="broken"
        transport="stdio"
        target="npx broken-mcp"
        authConfigured={false}
        syncedCount={1}
        errorCount={2}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/2 error/i)).toBeDefined();
  });
});
```

**Step 2: Implement ServerCard**

```tsx
interface ServerCardProps {
  name: string;
  transport: string;
  target: string;
  authConfigured: boolean;
  syncedCount: number;
  errorCount: number;
  onClick: () => void;
}

export function ServerCard(props: ServerCardProps): JSX.Element {
  return (
    <div className="server-card" onClick={props.onClick}>
      <div className="server-card-header">
        <span className="server-name">{props.name}</span>
        <span className="server-transport">{props.transport}</span>
        {props.authConfigured && <span className="server-auth-badge" title="Auth configured" />}
      </div>
      <div className="server-card-target">{props.target}</div>
      <div className="server-card-footer">
        <span>{props.syncedCount} synced</span>
        {props.errorCount > 0 && (
          <span className="server-error-count">
            {props.errorCount} error{props.errorCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Implement Dashboard**

```tsx
import { useState } from "react";
import { useStatus } from "../hooks/useMcpx";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";
import { BrowseTab } from "./BrowseTab";
import { DaemonControls } from "./DaemonControls";

type Tab = "servers" | "browse" | "settings";

export function Dashboard(): JSX.Element {
  const { status, loading, refresh } = useStatus();
  const [tab, setTab] = useState<Tab>("servers");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  if (loading || !status) {
    return <div className="dashboard">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    servers: Array<{
      name: string;
      transport: string;
      target: string;
      authBindings: unknown[];
      clients: Array<{ status: string; managed: boolean }>;
    }>;
  };

  if (selectedServer) {
    const server = report.servers.find((s) => s.name === selectedServer);
    if (server) {
      return (
        <ServerDetail
          server={server}
          onBack={() => setSelectedServer(null)}
          onRefresh={refresh}
        />
      );
    }
  }

  return (
    <div className="dashboard">
      <nav className="dashboard-tabs">
        <button data-active={tab === "servers"} onClick={() => setTab("servers")}>Servers</button>
        <button data-active={tab === "browse"} onClick={() => setTab("browse")}>Browse</button>
        <button data-active={tab === "settings"} onClick={() => setTab("settings")}>Settings</button>
      </nav>

      {tab === "servers" && (
        <div className="server-list">
          <DaemonControls daemon={report.daemon} onRefresh={refresh} />
          {report.servers.map((server) => (
            <ServerCard
              key={server.name}
              name={server.name}
              transport={server.transport}
              target={server.target}
              authConfigured={server.authBindings.length > 0}
              syncedCount={server.clients.filter((c) => c.managed && c.status === "SYNCED").length}
              errorCount={server.clients.filter((c) => c.managed && c.status === "ERROR").length}
              onClick={() => setSelectedServer(server.name)}
            />
          ))}
        </div>
      )}

      {tab === "browse" && <BrowseTab onServerAdded={refresh} />}
    </div>
  );
}
```

**Step 4: Run tests**

```bash
cd app && npx vitest run test/components/
```

**Step 5: Commit**

```bash
git add app/src/renderer/components/ app/test/components/
git commit -m "feat: add Dashboard shell, ServerCard, and tab navigation"
```

---

### Task 10: ServerDetail and DaemonControls

**Files:**
- Create: `app/src/renderer/components/ServerDetail.tsx`
- Create: `app/src/renderer/components/DaemonControls.tsx`
- Create: `app/test/components/DaemonControls.test.tsx`

Follow same TDD pattern: write test → verify fail → implement → verify pass → commit.

`DaemonControls` shows daemon status line + start/stop/restart buttons. `ServerDetail` shows full server info, auth bindings, client sync table, and action buttons (remove server, etc.).

**Commit message:** `feat: add ServerDetail and DaemonControls components`

---

## Phase 6: Registry Client + Browse

### Task 11: MCP Registry API client

**Files:**
- Create: `app/src/main/registry-client.ts`
- Create: `app/test/registry-client.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { fetchRegistryServers, fetchServerDetail } from "../src/main/registry-client";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("registry client", () => {
  it("fetches paginated server list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        servers: [
          { server: { name: "io.github.example/test", description: "Test server", version: "1.0.0" } }
        ],
        metadata: { count: 1, nextCursor: null }
      })
    });

    const result = await fetchRegistryServers();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].server.name).toBe("io.github.example/test");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v0.1/servers"),
      expect.any(Object)
    );
  });

  it("passes cursor for pagination", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [], metadata: { count: 0, nextCursor: null } })
    });

    await fetchRegistryServers("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("cursor=abc123"),
      expect.any(Object)
    );
  });

  it("fetches latest version detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        server: {
          name: "io.github.example/test",
          description: "Test",
          version: "1.0.0",
          packages: [{
            registryType: "npm",
            identifier: "@example/test",
            version: "1.0.0",
            transport: { type: "stdio" }
          }]
        }
      })
    });

    const result = await fetchServerDetail("io.github.example/test");
    expect(result.server.packages).toHaveLength(1);
    expect(result.server.packages[0].registryType).toBe("npm");
  });
});
```

**Step 2: Implement registry client**

`app/src/main/registry-client.ts`:
```typescript
const REGISTRY_BASE = "https://registry.modelcontextprotocol.io";
const DEFAULT_LIMIT = 30;

export interface RegistryServerEntry {
  server: {
    name: string;
    title?: string;
    description?: string;
    version: string;
    packages?: RegistryPackage[];
    remotes?: RegistryRemote[];
  };
  _meta?: Record<string, unknown>;
}

export interface RegistryPackage {
  registryType: string;
  registryBaseUrl?: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  transport: { type: string; url?: string };
  environmentVariables?: RegistryEnvVar[];
  packageArguments?: RegistryArgument[];
}

export interface RegistryRemote {
  type: string;
  url: string;
  headers?: RegistryHeader[];
  variables?: Record<string, { description?: string; isRequired?: boolean }>;
}

export interface RegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface RegistryArgument {
  type: "positional" | "named";
  name?: string;
  value?: string;
  valueHint?: string;
  description?: string;
  isRequired?: boolean;
  default?: string;
}

export interface RegistryHeader {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface RegistryListResponse {
  servers: RegistryServerEntry[];
  metadata: { count: number; nextCursor: string | null };
}

export interface RegistryDetailResponse {
  server: RegistryServerEntry["server"];
  _meta?: Record<string, unknown>;
}

export async function fetchRegistryServers(
  cursor?: string,
  query?: string,
  limit = DEFAULT_LIMIT
): Promise<RegistryListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (query) params.set("q", query);

  const response = await fetch(`${REGISTRY_BASE}/v0.1/servers?${params}`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Registry API error: ${response.status}`);
  }

  return response.json();
}

export async function fetchServerDetail(name: string): Promise<RegistryDetailResponse> {
  const encoded = encodeURIComponent(name);
  const response = await fetch(`${REGISTRY_BASE}/v0.1/servers/${encoded}/versions/latest`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Registry API error: ${response.status}`);
  }

  return response.json();
}
```

**Step 3: Run tests**

```bash
cd app && npx vitest run test/registry-client.test.ts
```

Expected: PASS.

**Step 4: Wire into IPC handlers**

Add registry IPC handlers in `ipc-handlers.ts`:
```typescript
import { fetchRegistryServers, fetchServerDetail } from "./registry-client";

ipcMain.handle(IPC.REGISTRY_LIST, (_event, cursor?: string, query?: string) => {
  return fetchRegistryServers(cursor, query);
});

ipcMain.handle(IPC.REGISTRY_GET, (_event, name: string) => {
  return fetchServerDetail(name);
});
```

**Step 5: Commit**

```bash
git add app/src/main/registry-client.ts app/test/registry-client.test.ts app/src/main/ipc-handlers.ts
git commit -m "feat: add MCP Registry API client with tests"
```

---

### Task 12: server.json to UpstreamServerSpec mapper

**Files:**
- Create: `app/src/main/server-mapper.ts`
- Create: `app/test/server-mapper.test.ts`

This is the critical logic that converts a `server.json` entry into an mcpx `UpstreamServerSpec`, auto-selecting the best package and extracting required inputs.

**Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { mapServerToSpec, selectBestPackage, extractRequiredInputs } from "../src/main/server-mapper";

describe("selectBestPackage", () => {
  it("prefers npm stdio over remote http", () => {
    const result = selectBestPackage(
      [{ registryType: "npm", identifier: "@test/pkg", transport: { type: "stdio" } }],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("package");
    expect(result.package?.registryType).toBe("npm");
  });

  it("prefers pypi over remote http", () => {
    const result = selectBestPackage(
      [{ registryType: "pypi", identifier: "test-pkg", transport: { type: "stdio" } }],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("package");
  });

  it("falls back to remote when no packages", () => {
    const result = selectBestPackage(
      [],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("remote");
  });
});

describe("extractRequiredInputs", () => {
  it("returns empty for server with no required env vars or args", () => {
    const inputs = extractRequiredInputs({
      kind: "package",
      package: { registryType: "npm", identifier: "@test/pkg", transport: { type: "stdio" } }
    });
    expect(inputs).toEqual([]);
  });

  it("extracts required secret env vars", () => {
    const inputs = extractRequiredInputs({
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@test/pkg",
        transport: { type: "stdio" },
        environmentVariables: [
          { name: "API_KEY", description: "Your API key", isRequired: true, isSecret: true },
          { name: "LOG_LEVEL", description: "Log level", default: "info" }
        ]
      }
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      name: "API_KEY",
      description: "Your API key",
      isSecret: true,
      kind: "env"
    });
  });
});

describe("mapServerToSpec", () => {
  it("maps npm package to stdio spec", () => {
    const spec = mapServerToSpec("test-server", {
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@test/server-pkg",
        version: "1.0.0",
        transport: { type: "stdio" }
      }
    }, {});
    expect(spec.transport).toBe("stdio");
    expect((spec as { command: string }).command).toBe("npx");
    expect((spec as { args: string[] }).args).toContain("@test/server-pkg@1.0.0");
  });

  it("maps pypi package to stdio spec with uvx", () => {
    const spec = mapServerToSpec("weather", {
      kind: "package",
      package: {
        registryType: "pypi",
        identifier: "weather-mcp",
        version: "0.5.0",
        transport: { type: "stdio" }
      }
    }, {});
    expect((spec as { command: string }).command).toBe("uvx");
    expect((spec as { args: string[] }).args).toContain("weather-mcp");
  });

  it("maps remote to http spec", () => {
    const spec = mapServerToSpec("cloud", {
      kind: "remote",
      remote: { type: "streamable-http", url: "https://cloud.example.com/mcp" }
    }, {});
    expect(spec.transport).toBe("http");
    expect((spec as { url: string }).url).toBe("https://cloud.example.com/mcp");
  });

  it("includes env vars with secret refs", () => {
    const spec = mapServerToSpec("brave", {
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@mcp/brave-search",
        version: "1.0.0",
        transport: { type: "stdio" },
        environmentVariables: [
          { name: "BRAVE_API_KEY", isRequired: true, isSecret: true }
        ]
      }
    }, { BRAVE_API_KEY: "secret://brave_api_key" });
    expect((spec as { env: Record<string, string> }).env?.BRAVE_API_KEY).toBe("secret://brave_api_key");
  });
});
```

**Step 2: Implement mapper**

`app/src/main/server-mapper.ts`:
```typescript
import type { UpstreamServerSpec } from "@mcpx/core";
import type { RegistryPackage, RegistryRemote } from "./registry-client";

interface SelectedPackage {
  kind: "package";
  package: RegistryPackage;
  remote?: undefined;
}

interface SelectedRemote {
  kind: "remote";
  remote: RegistryRemote;
  package?: undefined;
}

export type SelectedOption = SelectedPackage | SelectedRemote;

export interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
}

const PACKAGE_PRIORITY: Record<string, number> = {
  npm: 1,
  pypi: 2,
  nuget: 3,
  oci: 4,
  mcpb: 5
};

const RUNTIME_HINT: Record<string, string> = {
  npm: "npx",
  pypi: "uvx",
  nuget: "dnx"
};

export function selectBestPackage(
  packages: RegistryPackage[] = [],
  remotes: RegistryRemote[] = []
): SelectedOption {
  const stdioPkgs = packages
    .filter((p) => p.transport.type === "stdio")
    .sort((a, b) => (PACKAGE_PRIORITY[a.registryType] ?? 99) - (PACKAGE_PRIORITY[b.registryType] ?? 99));

  if (stdioPkgs.length > 0) {
    return { kind: "package", package: stdioPkgs[0] };
  }

  const httpRemotes = remotes.filter((r) => r.type === "streamable-http" || r.type === "sse");
  if (httpRemotes.length > 0) {
    return { kind: "remote", remote: httpRemotes[0] };
  }

  if (packages.length > 0) {
    return { kind: "package", package: packages[0] };
  }

  if (remotes.length > 0) {
    return { kind: "remote", remote: remotes[0] };
  }

  throw new Error("Server has no packages or remotes");
}

export function extractRequiredInputs(option: SelectedOption): RequiredInput[] {
  const inputs: RequiredInput[] = [];

  if (option.kind === "package" && option.package.environmentVariables) {
    for (const env of option.package.environmentVariables) {
      if (env.isRequired && !env.default) {
        inputs.push({
          name: env.name,
          description: env.description,
          isSecret: env.isSecret ?? false,
          kind: "env"
        });
      }
    }

    for (const arg of option.package.packageArguments ?? []) {
      if (arg.isRequired && !arg.value && !arg.default) {
        inputs.push({
          name: arg.name ?? arg.valueHint ?? "arg",
          description: arg.description,
          isSecret: false,
          kind: "arg"
        });
      }
    }
  }

  if (option.kind === "remote" && option.remote.headers) {
    for (const header of option.remote.headers) {
      if (header.isRequired && !header.default) {
        inputs.push({
          name: header.name,
          description: header.description,
          isSecret: header.isSecret ?? false,
          kind: "header"
        });
      }
    }
  }

  return inputs;
}

export function mapServerToSpec(
  _name: string,
  option: SelectedOption,
  resolvedValues: Record<string, string>
): UpstreamServerSpec {
  if (option.kind === "remote") {
    const headers: Record<string, string> = {};
    for (const header of option.remote.headers ?? []) {
      const value = resolvedValues[header.name] ?? header.default;
      if (value) headers[header.name] = value;
    }
    return {
      transport: "http",
      url: option.remote.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {})
    };
  }

  const pkg = option.package;
  const runtime = pkg.runtimeHint ?? RUNTIME_HINT[pkg.registryType] ?? "npx";
  const args: string[] = [];

  const identifier = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
  args.push(identifier);

  for (const arg of pkg.packageArguments ?? []) {
    const value = arg.value ?? resolvedValues[arg.name ?? arg.valueHint ?? ""] ?? arg.default;
    if (!value) continue;
    if (arg.type === "named" && arg.name) {
      args.push(arg.name, value);
    } else {
      args.push(value);
    }
  }

  const env: Record<string, string> = {};
  for (const envVar of pkg.environmentVariables ?? []) {
    const value = resolvedValues[envVar.name] ?? envVar.default;
    if (value) env[envVar.name] = value;
  }

  return {
    transport: "stdio",
    command: runtime,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {})
  };
}
```

**Step 3: Run tests**

```bash
cd app && npx vitest run test/server-mapper.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add app/src/main/server-mapper.ts app/test/server-mapper.test.ts
git commit -m "feat: add server.json to UpstreamServerSpec mapper with tests"
```

---

### Task 13: BrowseTab and AddServerForm components

**Files:**
- Create: `app/src/renderer/components/BrowseTab.tsx`
- Create: `app/src/renderer/components/AddServerForm.tsx`
- Create: `app/test/components/BrowseTab.test.tsx`
- Create: `app/test/components/AddServerForm.test.tsx`

**Step 1: Write AddServerForm test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddServerForm } from "../../src/renderer/components/AddServerForm";

describe("AddServerForm", () => {
  it("renders nothing when no required inputs", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AddServerForm requiredInputs={[]} onSubmit={onSubmit} onCancel={() => {}} />
    );
    // Should auto-submit with no inputs
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it("renders input fields for required values", () => {
    render(
      <AddServerForm
        requiredInputs={[
          { name: "API_KEY", description: "Your API key", isSecret: true, kind: "env" }
        ]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByLabelText(/API_KEY/i)).toBeDefined();
    expect(screen.getByText(/Your API key/i)).toBeDefined();
  });

  it("uses password input for secret fields", () => {
    render(
      <AddServerForm
        requiredInputs={[
          { name: "TOKEN", description: "Secret token", isSecret: true, kind: "env" }
        ]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    const input = screen.getByLabelText(/TOKEN/i) as HTMLInputElement;
    expect(input.type).toBe("password");
  });
});
```

**Step 2: Implement AddServerForm**

```tsx
import { useEffect, useState } from "react";

interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
}

interface AddServerFormProps {
  requiredInputs: RequiredInput[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export function AddServerForm({ requiredInputs, onSubmit, onCancel }: AddServerFormProps): JSX.Element | null {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (requiredInputs.length === 0) {
      onSubmit({});
    }
  }, [requiredInputs, onSubmit]);

  if (requiredInputs.length === 0) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form className="add-server-form" onSubmit={handleSubmit}>
      {requiredInputs.map((input) => (
        <div key={input.name} className="form-field">
          <label htmlFor={input.name}>{input.name}</label>
          {input.description && <p className="field-description">{input.description}</p>}
          <input
            id={input.name}
            type={input.isSecret ? "password" : "text"}
            value={values[input.name] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [input.name]: e.target.value }))}
            required
          />
        </div>
      ))}
      <div className="form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Add</button>
      </div>
    </form>
  );
}
```

**Step 3: Implement BrowseTab**

`BrowseTab` uses `useRegistryList` hook, renders server cards from the registry, and handles the add flow: fetch detail → select best package → check required inputs → show form or add directly.

The add flow IPC should call a new `REGISTRY_ADD` handler that:
1. Calls `fetchServerDetail`
2. Calls `selectBestPackage` and `extractRequiredInputs`
3. Returns required inputs to renderer
4. Renderer shows `AddServerForm` if needed
5. On submit, renderer sends resolved values back via `addServer` IPC
6. Main process calls `mapServerToSpec` → `addServer()` → `syncAllClients()`

**Step 4: Run tests**

```bash
cd app && npx vitest run test/components/
```

**Step 5: Commit**

```bash
git add app/src/renderer/components/BrowseTab.tsx app/src/renderer/components/AddServerForm.tsx app/test/components/
git commit -m "feat: add BrowseTab and AddServerForm with one-click add flow"
```

---

## Phase 7: E2E Tests

### Task 14: Set up Playwright for Electron E2E

**Files:**
- Create: `app/playwright.config.ts`
- Create: `app/e2e/browse-and-add.spec.ts`
- Create: `app/e2e/status-popover.spec.ts`
- Create: `app/e2e/dashboard-navigation.spec.ts`
- Modify: `app/package.json` (add playwright deps + e2e script)

**Step 1: Add Playwright dependencies**

Add to `app/package.json` devDependencies:
```json
{
  "@playwright/test": "^1.52.0",
  "electron": "^35.0.0"
}
```

Add script:
```json
{
  "e2e": "playwright test"
}
```

**Step 2: Create Playwright config**

`app/playwright.config.ts`:
```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  use: {
    trace: "on-first-retry"
  }
});
```

**Step 3: Write E2E tests**

`app/e2e/dashboard-navigation.spec.ts`:
```typescript
import { test, expect, _electron as electron } from "@playwright/test";

test.describe("dashboard navigation", () => {
  test("can navigate from server list to detail and back", async () => {
    const app = await electron.launch({ args: ["./out/main/index.js"] });
    const window = await app.firstWindow();

    // Navigate to dashboard
    await window.goto(`file://${process.cwd()}/out/renderer/index.html#dashboard`);

    // Verify server list renders
    await expect(window.locator(".server-list")).toBeVisible();

    // Click a server card (if any exist)
    const cards = window.locator(".server-card");
    if (await cards.count() > 0) {
      await cards.first().click();
      await expect(window.locator(".server-detail")).toBeVisible();

      // Go back
      await window.locator("button", { hasText: "Back" }).click();
      await expect(window.locator(".server-list")).toBeVisible();
    }

    await app.close();
  });
});
```

Write similar tests for browse-and-add and status-popover flows.

**Step 4: Build app and run E2E**

```bash
cd app && npm run build && npx playwright test
```

**Step 5: Commit**

```bash
git add app/e2e/ app/playwright.config.ts app/package.json
git commit -m "feat: add Playwright E2E tests for Electron app"
```

---

## Phase 8: Polish

### Task 15: Update root README and .gitignore

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

**Step 1: Update `.gitignore`**

Add Electron-specific ignores:
```
# Electron
app/out/
app/dist/
app/node_modules/

# CLI
cli/dist/
cli/node_modules/
```

**Step 2: Update root README**

Add a section about the desktop app, how to develop it, and the monorepo structure.

**Step 3: Update CLAUDE.md**

Update project structure, build commands, and development instructions to reflect the monorepo layout:
- CLI: `cd cli && npm install && npm test`
- App: `cd app && npm install && npm run dev`

**Step 4: Commit**

```bash
git add README.md .gitignore CLAUDE.md
git commit -m "docs: update README and project docs for monorepo structure"
```
