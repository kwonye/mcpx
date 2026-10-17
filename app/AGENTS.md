# Desktop App Overview

The `mcpx` desktop app provides a visual interface for managing MCP servers, featuring a macOS menubar tray with a quick-status popover and a comprehensive dashboard with tabs for managing servers, projects, plugins, and settings.

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
- **Dashboard:** Tabbed interface with multiple views for server management and configuration.
- **Servers Tab:** Server list, detail views, and real-time logs.
- **Projects Tab:** Per-project server toggles and project-level configuration.
- **Plugins Tab:** Plugin management UI with an embedded Shared Skills editor for ownership-managed skill projections.
- **Settings Tab:** Global configuration and preferences.

## Building and Installing Locally

### Quick Install
To build and install the production app to `/Applications`:

```bash
bun run desktop-install
```

For the side-by-side dev app with DevTools open:
```bash
bun run desktop-install:dev
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
bun run dev
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
bun install
```

### Key Commands
- `bun run dev`: Starts the development environment with Electron HMR.
- `bun run build`: Bundles the main, preload, and renderer processes.
- `bun run test`: Executes component and unit tests.
- `bun run e2e`: Runs Playwright end-to-end tests against the built app.
- `bun run desktop-install`: Builds and installs `/Applications/mcpx.app`.
- `bun run desktop-install:dev`: Builds and installs `/Applications/mcpx-dev.app` with DevTools open.
- `bun run desktop-install:dev-app`: Builds and installs `/Applications/mcpx-dev.app` without opening DevTools.

## Integration with CLI
The app imports business logic directly from `../cli/src/core/index.ts` using the `@mcpx/core` TypeScript alias. This ensures that the CLI and Desktop app always share identical configuration parsing, sync logic, and secret management.
