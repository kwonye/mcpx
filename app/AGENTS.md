# Desktop App Overview

The `mcpx` desktop app provides a visual interface for managing MCP servers, featuring a menubar tray icon, a dashboard, and discovery tools.

## Technologies
- **Framework:** Electron
- **UI:** React 19 + TypeScript
- **Styling:** Vanilla CSS
- **Build Tool:** electron-vite
- **Testing:** 
  - Vitest + React Testing Library (Unit/Component)
  - Playwright (E2E)

## Architecture

The desktop app is integrated with the CLI core logic. It uses a TypeScript path alias `@mcpx/core` to import business logic directly from `cli/src/core/index.ts`.

- **Main Process (`src/main/`):** Handles IPC, tray management, window lifecycle, and bridges core logic.
- **Preload (`src/preload/`):** Exposes a typed API to the renderer via `contextBridge`.
- **Renderer (`src/renderer/`):** React-based UI.
- **Shared (`src/shared/`):** IPC channel constants and shared types.

## Development Conventions

- **State Management:** Uses React hooks (`useMcpx`) to interact with the Electron backend.
- **IPC Communication:** Strictly defined channels in `src/shared/ipc-channels.ts`.
- **Building:** 
  - `npm run dev`: Starts the development server.
  - `npm run build`: Bundles the app for production.
- **Packaging:** Uses `electron-builder` (via the release workflow or manual trigger).

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
npm run build
npx electron-builder --mac --dir  # Build without DMG (faster)

# Kill any running instances
pkill -f "mcpx" || true

# Replace old app
rm -rf /Applications/mcpx.app
cp -r dist/mac-arm64/mcpx.app /Applications/

# Open the new app
open /Applications/mcpx.app
```

**Note:** The app is a menubar-only app (no dock icon). Look for the tray icon in the menubar.

## Integration with Core

The app resolves the `@mcpx/core` alias in `electron.vite.config.ts`. Any changes to the core library in the `cli/` directory are immediately available to the desktop app during development.
\n<!-- trigger mixed release -->
