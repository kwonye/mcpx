# Desktop App Overview

The `mcpx` desktop app provides a visual interface for managing MCP servers, featuring a menubar tray icon, a comprehensive dashboard, and a discovery "Browse" tab.

## Architecture

The app is built with **Electron + React** and is designed to be a lightweight wrapper around the `mcpx` core library.

### Main Process (`src/main/`)
- **Lifecycle:** Manages the Electron app lifecycle and window state.
- **Tray:** Implements a macOS-native menubar tray with a quick-status popover.
- **Daemon Management:** Controls the background `mcpx` gateway.
- **IPC Handlers:** Bridges the renderer to the core CLI logic via `@mcpx/core`.
- **Daemon-Child Mode:** Includes logic to run the gateway as a dedicated child process (`src/main/daemon-child.ts`), ensuring the gateway stays alive even if the dashboard is closed.

### Preload (`src/preload/`)
- Exposes a secure, typed API to the renderer process via `contextBridge`.
- Maps core CLI operations (add, sync, status) to frontend-friendly promises.

### Renderer (`src/renderer/`)
- **UI Framework:** React 19.
- **State Management:** Custom `useMcpx` hook for interacting with the backend.
- **Dashboard:** Server list, detail views, and real-time logs.
- **Browse Tab:** Discovery interface for finding and installing servers from the official MCP Registry.

## Building and Installing Locally

### Kill Existing Instances
Kill any running instances before starting a new one:

```bash
pkill -f "mcpx" || true
pkill -f "Electron.*mcpx-desktop" || true
```

### Development Mode
For development with hot reload:

```bash
cd app
npm run dev
```

This runs the app from source with the dev server. Check the menubar for the tray icon.

### Build and Install Local .app
To build a production .app bundle and install it (replacing any existing):

```bash
cd app
npm install
npm run build
npx electron-builder --mac --dir  # Build without DMG (faster)

# Kill any running instances
pkill -f "/Applications/mcpx.app" || true
pkill -f "dist/mac-arm64/mcpx.app" || true

# Replace old app while preserving bundle metadata/signature
ts=$(date +%Y%m%d-%H%M%S)
if [ -d /Applications/mcpx.app ]; then
  mv /Applications/mcpx.app "/Applications/mcpx.app.backup-$ts"
fi
ditto dist/mac-arm64/mcpx.app /Applications/mcpx.app
codesign --verify --deep --strict /Applications/mcpx.app

# Open the new app
open /Applications/mcpx.app
```

**Notes:**
- Use `ditto`, not `cp -R`, to install the app bundle into `/Applications`; `cp -R` can break the app signature.
- The local `--dir` build may still fail `spctl` because it is not notarized. For local installs, a passing `codesign --verify` and a successful `open` are the expected checks.
- The app is a menubar-only app (no dock icon). Look for the tray icon in the menubar.

## Technologies
- **Styling:** Pure Vanilla CSS (no Tailwind/Bootstrap).
- **Build Tool:** `electron-vite` for optimized dev/build cycles.
- **Testing:** 
  - **Unit:** Vitest + React Testing Library for components.
  - **E2E:** Playwright for Electron-specific integration tests.

## Integration with Core

## Development

### Setup
```bash
cd app
npm install
```

### Key Commands
- `npm run dev`: Starts the development environment with Electron HMR.
- `npm run build`: Bundles the main, preload, and renderer processes.
- `npm test`: Executes component and unit tests.
- `npm run e2e`: Runs Playwright end-to-end tests against the built app.

## Integration with CLI
The app imports business logic directly from `../cli/src/core/index.ts` using the `@mcpx/core` TypeScript alias. This ensures that the CLI and Desktop app always share identical configuration parsing, sync logic, and secret management.
