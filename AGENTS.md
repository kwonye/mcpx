# Project Overview

`mcpx` is an HTTP-first Model Context Protocol (MCP) gateway and cross-client installer. This is a monorepo with two primary packages:

- **`cli/`** — The `mcpx` CLI and core library (`@kwonye/mcpx`).
- **`app/`** — The macOS desktop app (Electron + React).

## Monorepo Structure

```text
cli/                    # CLI package
  src/cli.ts            # CLI entry point and command registration
  src/core/             # Core business logic (config, daemon, sync, secrets, etc.)
  src/core/index.ts     # Barrel export for core modules (consumed by app)
  src/gateway/          # HTTP gateway server (JSON-RPC proxy)
  src/adapters/         # Client-specific sync adapters (Claude, Cursor, VS Code, etc.)
  src/compat/           # Client-native "add" compatibility layer (claude, codex, etc.)
  src/types.ts          # Shared TypeScript types
  test/                 # CLI unit and integration tests

app/                    # Desktop app
  src/main/             # Electron main process (Tray, IPC, Window management)
  src/main/daemon-child.ts # Dedicated mode for running the daemon as a child process
  src/preload/          # Context bridge (exposes mcpx API to renderer)
  src/renderer/         # React UI (Dashboard, Browse Tab, Settings)
  src/shared/           # Shared types and IPC channel constants
  test/                 # Unit/Component tests (Vitest + RTL)
  e2e/                  # E2E tests (Playwright)

.github/workflows/      # CI/CD (Separate CLI and Desktop release pipelines)
```

## Architecture & Integration

The desktop app is tightly integrated with the CLI's core logic. It does not use npm workspaces; instead, it imports core business logic directly from the `cli/` directory via a TypeScript path alias.

- **Alias:** `@mcpx/core` → `cli/src/core/index.ts` (resolved by `electron-vite`).
- **IPC Bridge:** The Electron main process (`app/src/main/ipc-handlers.ts`) wraps core functions and exposes them to the renderer.
- **Shared Secrets:** Both CLI and Desktop app share the same macOS Keychain backend for credentials.

## Building and Running

### Prerequisites
- Node.js >= 20
- macOS (required for keychain and desktop app features)

### CLI
```bash
cd cli
npm install
npm run build           # Build to dist/
npm run dev -- [args]    # Run src/cli.ts via tsx
npm test                # Run unit tests
```

### Desktop App
```bash
cd app
npm install
npm run dev             # Start Electron dev server with HMR
npm run build           # Build Electron app for production
npm test                # Run unit/component tests
npm run e2e             # Run Playwright E2E tests
```

## Development Mandates & Conventions

These rules are foundational for any agent working on this project:

- **ES Modules:** Use ESM throughout. All files should be `.ts` or `.tsx`.
- **Validation:** Always use `zod` for parsing and validating configuration or external data.
- **Styling:** Use **Vanilla CSS** for the React frontend. Do not add utility-first or heavy CSS frameworks.
- **Testing:** 
  - New logic in `cli/src/core/` must have tests in `cli/test/`.
  - UI components in `app/` should have tests in `app/test/components/`.
  - Significant user flows should be covered by Playwright in `app/e2e/`.
- **Secrets Management:** Never log or expose secrets. Use the `SecretsManager` class which interfaces with the macOS Keychain.
- **State:** Core state (servers, auth) is persisted in `~/.config/mcpx/config.json`.

## CI/CD & Versioning

The project uses a **single monotonic version stream** across both components. Every release increments a shared patch version.

- **CLI Release:** Triggered by `cli/**` changes. Publishes to npm and creates a git tag.
- **Desktop Release:** Triggered by `app/**` or `cli/**` changes. Builds signed/notarized macOS artifacts.
- **Mixed Releases:** If both components change, the CLI workflow owns the tag creation, and the Desktop workflow attaches artifacts to that tag.
