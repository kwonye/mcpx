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

## CI/CD Workflows

Top-level release/build workflows are split by target and must stay decoupled:

- **CLI release workflow**: `.github/workflows/cli-release.yml`
  - Trigger: push to `main` with changes in `cli/**`.
  - Responsibilities: build/test CLI, compute next shared release version, sync `cli/src/version.ts`, conditionally sync `app/package.json` for mixed releases, create annotated git tag, publish npm package, create/update GitHub Release notes.
  - Owns tag creation for `cli-only` and mixed (`cli/**` + `app/**`) releases.

- **Desktop release workflow**: `.github/workflows/desktop-release.yml`
  - Triggers:
    - push to `main` with changes in `app/**` or `cli/**`
    - push tags `v*`
    - `workflow_dispatch` with required `release_tag` input
  - Responsibilities: build desktop artifacts and publish according to trigger:
    - `main` push with `app/**` changes and no `cli/**` changes: create the next shared annotated `v*` tag (desktop-only release)
    - `main` push including `cli/**` changes (including mixed CLI+desktop commits): do not create a tag; wait for CLI-created `v*` tag
    - tag push with `include_desktop=true`: build/upload desktop assets to that GitHub Release tag
    - tag push with `include_desktop=false`: skip desktop artifacts (cli-only release)
    - manual dispatch: upload assets to provided `release_tag`
  - Signing behavior:
    - if all macOS signing/notarization secrets are present, produce signed/notarized build
    - if secrets are missing, fall back to unsigned build (`CSC_IDENTITY_AUTO_DISCOVERY=false`) and do not skip the workflow
  - Release tags use a single monotonic shared `v*` stream across components, with component-scoped release notes (`## CLI`, `## Desktop`).
