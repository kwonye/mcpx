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

### Quick Install
To build and install the production app to `/Applications`:

```bash
npm run desktop-install
```

For the side-by-side dev app with DevTools open:
```bash
npm run desktop-install:dev
```

This keeps `/Applications/mcpx.app` intact and installs the dev bundle to `/Applications/mcpx-dev.app`.

### Kill Existing Instances
Kill any running instances before starting a new one:

```bash
pkill -f "/Applications/mcpx-dev.app" || true
pkill -f "/Applications/mcpx.app" || true
pkill -f "Electron.*mcpx-desktop" || true
```

### Development Mode
For development with hot reload:

```bash
npm run dev
```

This runs the app from source with the dev server. Check the menubar for the tray icon.

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
- `npm run desktop-install`: Builds and installs `/Applications/mcpx.app`.
- `npm run desktop-install:dev`: Builds and installs `/Applications/mcpx-dev.app` with DevTools open.
- `npm run desktop-install:dev-app`: Builds and installs `/Applications/mcpx-dev.app` without opening DevTools.

## Integration with CLI
The app imports business logic directly from `../cli/src/core/index.ts` using the `@mcpx/core` TypeScript alias. This ensures that the CLI and Desktop app always share identical configuration parsing, sync logic, and secret management.
