# Technology Stack

**Analysis Date:** 2026-03-09

## Languages

**Primary:**
- TypeScript 5.9.3 - Used throughout both `cli/` and `app/` packages
- TSX (JSX in TypeScript) - Used for React components in `app/src/renderer/`

**Secondary:**
- JavaScript (ESM) - CI release scripts (`cli/scripts/sync-version.mjs`, `.github/scripts/release-coordinator.mjs`)
- CSS (Vanilla) - Renderer styling in `app/src/renderer/index.css`

## Runtime

**Environment:**
- Node.js >= 20 (enforced via `engines` in `cli/package.json`)
- Electron 35.x - Desktop app runtime (`app/`)

**Package Manager:**
- npm (no workspaces; each package has independent `package-lock.json`)
- Lockfiles: Present in both `cli/package-lock.json` and `app/package-lock.json`

## Frameworks

**Core:**
- React 19.1.x - Desktop app renderer UI (`app/src/renderer/`)
- Commander 14.x - CLI argument parsing (`cli/src/cli.ts`)
- Electron 35.x - Desktop app shell, IPC, tray, window management (`app/src/main/`)

**Testing:**
- Vitest 4.x - Unit/component tests for both `cli/` and `app/`
- Playwright 1.58.x - E2E tests for Electron app (`app/e2e/`)
- Testing Library React 16.x - Component testing (`app/test/`)
- Testing Library Jest-DOM 6.x - DOM assertion matchers (`app/`)
- jsdom 28.x - Browser environment simulation for Vitest (`app/vitest.config.ts`)

**Build/Dev:**
- `tsc` (TypeScript compiler) - CLI build (`cli/tsconfig.json`)
- `electron-vite` 3.x - Electron app build/dev with HMR (`app/electron.vite.config.ts`)
- `@vitejs/plugin-react` 4.x - React support in Vite/electron-vite
- `tsx` 4.x - Dev-time TypeScript execution for CLI (`npm run dev`)
- `electron-builder` (latest, invoked via npx) - macOS app packaging in CI

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` ^1.26.0 - MCP protocol client implementation; provides `Client`, `StdioClientTransport`, and stdio server parameter types. Used in `cli/src/gateway/server.ts` for upstream communication.
- `zod` ^4.1.12 - Schema validation for configuration files. Used in `cli/src/core/config.ts` for parsing `~/.config/mcpx/config.json`.
- `commander` ^14.0.1 - CLI command registration and argument parsing. Used in `cli/src/cli.ts`.

**Infrastructure:**
- `electron-updater` ^6.6.2 - Auto-update mechanism for the desktop app. Used in `app/src/main/update-manager.ts`. Publishes via GitHub Releases.
- `@iarna/toml` ^2.2.5 - TOML parsing for client adapter config files (used by adapters that read TOML-formatted configs).

## Configuration

**Environment:**
- `MCPX_CONFIG_HOME` / `XDG_CONFIG_HOME` - Override config root directory (default: `~/.config`)
- `MCPX_DATA_HOME` / `XDG_DATA_HOME` - Override data root directory (default: `~/.local/share`)
- `MCPX_STATE_HOME` / `XDG_STATE_HOME` - Override state root directory (default: `~/.local/state`)
- `MCPX_DAEMON_CHILD=1` - Signals the process is a daemon child (used by both CLI and Electron)
- `MCPX_GATEWAY_DEBUG=1` - Enables verbose gateway debug logging to stderr
- `MCPX_UPSTREAM_TIMEOUT_MS` - Configures upstream request timeout (default: 60000ms)
- `MCPX_SECRET_<name>` - Environment variable override for any named secret (bypasses keychain)

**Build:**
- `cli/tsconfig.json` - CLI TypeScript config (target ES2022, module NodeNext)
- `app/tsconfig.node.json` - Electron main process TypeScript config (module ESNext, bundler resolution)
- `app/tsconfig.web.json` - Renderer TypeScript config (ESNext, DOM libs, JSX react-jsx)
- `app/electron.vite.config.ts` - Vite config with `@mcpx/core` alias resolution pointing to `../cli/src/core/index.ts`
- `app/vitest.config.ts` - Test config (jsdom environment, globals enabled)
- `app/playwright.config.ts` - E2E config (30s timeout, trace on first retry)

**Key Config Files at Runtime:**
- `~/.config/mcpx/config.json` - Central server registry and gateway settings (Zod-validated)
- `~/.local/share/mcpx/managed-index.json` - Tracks which entries mcpx manages in client configs
- `~/.local/share/mcpx/secret-names.json` - Index of all keychain secret names
- `~/.local/state/mcpx/runtime/daemon.pid` - PID file for background daemon
- `~/.local/state/mcpx/logs/daemon.log` - Daemon log output
- `app.getPath("userData")/settings.json` - Desktop app settings (auto-update, start on login)

## Module System & Path Aliases

**Module System:** ESM throughout. Both packages use `"type": "module"` and `.js` extensions in imports.

**Path Aliases:**
- `@mcpx/core` -> `../cli/src/core/index.ts` - Defined in `app/tsconfig.node.json` and resolved by `electron-vite` in `app/electron.vite.config.ts`. Allows the desktop app main process to import CLI core logic directly.
- `@renderer/*` -> `./src/renderer/*` - Defined in `app/tsconfig.web.json` and resolved by electron-vite.

## Versioning

**Strategy:** Single monotonic version stream across CLI and desktop app.
- CLI version source of truth: `cli/package.json` (currently `0.1.3`)
- Runtime version constant: `cli/src/version.ts` (auto-synced via `cli/scripts/sync-version.mjs` during prebuild)
- Desktop app version: `app/package.json` (synced during CI releases)

## Platform Requirements

**Development:**
- macOS required (keychain integration, Electron tray, login items)
- Node.js >= 20
- npm (not yarn/pnpm)

**Production:**
- CLI: Published to npm as `@kwonye/mcpx` with provenance. Runs on any Node.js >= 20, but keychain features are macOS-only.
- Desktop: macOS-only. Built as universal binary (arm64 + x64). Distributed as signed+notarized DMG/ZIP via GitHub Releases. Auto-updates via `electron-updater`.

---

*Stack analysis: 2026-03-09*
