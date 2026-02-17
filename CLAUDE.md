# Project Overview

`mcpx` is an HTTP-first MCP gateway and cross-client installer. This is a monorepo with two packages:

- **`cli/`** — The `mcpx` CLI and core library (`@kwonye/mcpx`)
- **`app/`** — The macOS desktop app (Electron + React)

## Monorepo Structure

```
cli/                    # CLI package
  src/cli.ts            # CLI entry point
  src/core/             # Core business logic (config, daemon, sync, secrets, etc.)
  src/core/index.ts     # Barrel export for core modules
  src/gateway/          # HTTP gateway server
  src/adapters/         # Client-specific sync adapters
  src/types.ts          # Shared TypeScript types
  test/                 # CLI unit/integration tests
  package.json          # @kwonye/mcpx

app/                    # Desktop app
  src/main/             # Electron main process (IPC handlers, tray, dashboard)
  src/preload/          # Context bridge (exposes mcpx API to renderer)
  src/renderer/         # React UI (components, hooks)
  src/shared/           # Shared types (IPC channels)
  test/                 # Unit tests (vitest + React Testing Library)
  e2e/                  # E2E tests (Playwright)
  package.json          # mcpx-desktop

docs/plans/             # Design and implementation docs
```

## Building and Running

### CLI
```bash
cd cli
npm install
npm run build
npm test
npm run dev -- [args]    # Run in dev mode
```

### Desktop App
```bash
cd app
npm install
npm run build           # Build Electron app
npm run dev             # Start Electron dev server
npm test                # Run unit tests (vitest)
npm run e2e             # Run E2E tests (Playwright)
```

## Architecture

The desktop app imports core business logic directly from the CLI package via a TypeScript path alias (`@mcpx/core` → `cli/src/core/index.ts`). This is resolved at build time by electron-vite, not via npm workspaces. The Electron main process bridges core functions to the React renderer via IPC.

### Key Integration Points
- `app/electron.vite.config.ts` — defines `@mcpx/core` alias
- `app/src/main/ipc-handlers.ts` — bridges core modules to renderer
- `app/src/preload/index.ts` — exposes typed API via contextBridge
- `cli/src/core/index.ts` — barrel export consumed by the app

## Development Conventions

- ES Modules throughout (`"type": "module"`)
- Zod for config validation (`cli/src/core/config.ts`)
- vitest for unit tests in both packages
- React Testing Library for component tests
- Playwright for Electron E2E tests
- macOS keychain for secret storage
