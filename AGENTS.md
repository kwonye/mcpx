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
- Bun >= 1.2 (https://bun.sh)
- macOS (required for keychain and desktop app features)

Note: the tray/app icon generation scripts (`generate-status-icons.js`, `generate-app-icons.sh`) have been removed. The committed PNGs in `app/resources/` and `app/build/icons/` are the source of truth.

### CLI
```bash
cd cli
bun install
bun run build           # Build to dist/
bun run dev -- [args]    # Run src/cli.ts via tsx
bun test                # Run unit tests
```

### Desktop App
```bash
cd app
bun install
bun run dev             # Start Electron dev server with HMR
bun run build           # Build Electron app for production
bun run test            # Run unit/component tests
bun run e2e             # Run Playwright E2E tests
```

### Testing & Verifying Changes

All UI verification must be done on the installed app, not the dev server. The dev server (`bun run dev`) serves content from `ELECTRON_RENDERER_URL` which differs from the bundled app.

**Step-by-step:**

1. Kill existing instances:
   ```bash
   pkill -9 -f "/Applications/mcpx-dev.app" || true
   pkill -9 -f "/Applications/mcpx.app" || true
   pkill -9 -E "Electron" || true
   ```

2. Build and install the side-by-side dev app with DevTools open:
   ```bash
   cd app
   bun run desktop-install:dev
   ```
   This builds the dev app, installs it to `/Applications/mcpx-dev.app`, and launches it with DevTools auto-opened on the dashboard.

   To rebuild the normal production bundle locally instead:
   ```bash
   bun run desktop-install
   ```

3. Inspect the dashboard in the DevTools panel that appears.

4. To inspect the popover (menubar tray): right-click inside the popover and select "Inspect". DevTools must already be open from the dashboard. The popover does NOT auto-open DevTools.

5. After making code changes, repeat step 2 to rebuild and verify.

**For automated inspection with agent-browser:**
```bash
cd app
bash scripts/desktop-install.sh --flavor dev --dev --remote-debugging-port 9222
```
Then use `agent-browser --cdp 9222 ...` commands as described below.

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

## Developer Tools

### Browser Automation (agent-browser)

The Electron desktop app can be automated and inspected via Chrome DevTools Protocol using `agent-browser`. Use this for scripted UI verification.

**For launching with CDP, see "Testing & Verifying Changes" above.** Launch the installed app with `--remoteDebuggingPort 9222` as shown there.

**Important:** Always clean up first:

```bash
pkill -9 -f "/Applications/mcpx-dev.app" || true
pkill -9 -f "/Applications/mcpx.app" || true
pkill -9 -E "Electron" || true
agent-browser close --all  # Close any stale agent-browser sessions
sleep 1
```

**Use `--cdp` flag, NEVER `connect`:** Electron does not support `Target.createTarget` via CDP, so `agent-browser connect 9222` always fails. Use the `--cdp` flag on standalone commands instead:

```bash
agent-browser --cdp 9222 snapshot -i          # Accessibility tree with refs
agent-browser --cdp 9222 screenshot dump.png  # Full page screenshot
agent-browser --cdp 9222 tab                  # List Electron windows
agent-browser --cdp 9222 get text @e1         # Get text by ref
agent-browser --cdp 9222 click @e2            # Click by ref
```

**Workflow for verifying UI changes:**

1. Kill existing instances, rebuild, and launch with CDP port (see "Testing & Verifying Changes" → agent-browser section)
2. Wait: `sleep 3`
3. Inspect: `agent-browser --cdp 9222 snapshot -i`
4. Capture: `agent-browser --cdp 9222 screenshot /tmp/before.png`
5. Make changes, rebuild, and relaunch
6. Verify: `agent-browser --cdp 9222 screenshot /tmp/after.png`

The app has 2 CDP tabs: the dashboard (main window) and the popover (menubar tray). Use `agent-browser --cdp 9222 tab` to list them, `agent-browser --cdp 9222 tab 0` to switch.

## CI/CD & Versioning

The project uses a **single monotonic version stream** across both components. Every release increments a shared patch version.

- **CLI Release:** Triggered by `cli/**` changes. Publishes via `bun publish` to the npm registry and creates a git tag.
- **Desktop Release:** Triggered by `app/**` or `cli/**` changes. Builds signed/notarized macOS artifacts.
- **Mixed Releases:** If both components change, the CLI workflow owns the tag creation, and the Desktop workflow attaches artifacts to that tag.
