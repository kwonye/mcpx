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

## Integration with Core

The app resolves the `@mcpx/core` alias in `electron.vite.config.ts`. Any changes to the core library in the `cli/` directory are immediately available to the desktop app during development.
\n<!-- trigger mixed release -->
