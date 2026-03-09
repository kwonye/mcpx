# Architecture

**Analysis Date:** 2026-03-09

## Pattern Overview

**Overall:** Monorepo with a shared-core library pattern. The CLI package (`cli/`) owns all business logic, and the desktop app (`app/`) imports core modules directly via a TypeScript path alias. No npm workspaces -- the integration is handled at the build tool level by `electron-vite`.

**Key Characteristics:**
- Two entry points (CLI binary and Electron app) share a single core library
- HTTP gateway daemon acts as a JSON-RPC proxy between AI clients and upstream MCP servers
- Client adapter pattern allows syncing configuration to multiple AI clients simultaneously
- macOS Keychain is the single secrets backend; secrets are referenced via `secret://` URI scheme
- Configuration is file-based JSON at `~/.config/mcpx/config.json`, validated with Zod

## Layers

**Core (`cli/src/core/`)**
- Purpose: All business logic shared between CLI and desktop app
- Location: `cli/src/core/`
- Contains: Config management, daemon lifecycle, client sync, secrets, server registry, status reporting, auth probing
- Depends on: `cli/src/types.ts`, `cli/src/util/fs.ts`, `cli/src/adapters/`, macOS Keychain (`security` CLI)
- Used by: `cli/src/cli.ts` (CLI entry), `app/src/main/` (Electron main process via `@mcpx/core` alias)
- Barrel export: `cli/src/core/index.ts`

**Gateway (`cli/src/gateway/`)**
- Purpose: HTTP server that proxies JSON-RPC requests to upstream MCP servers
- Location: `cli/src/gateway/server.ts`
- Contains: HTTP server creation, JSON-RPC multiplexing, upstream routing (HTTP and stdio), OAuth well-known endpoint proxying, SSE response handling
- Depends on: `cli/src/core/config.ts`, `cli/src/core/secrets.ts`, `@modelcontextprotocol/sdk`
- Used by: `cli/src/core/daemon.ts` (foreground mode), CLI `daemon run` command

**Adapters (`cli/src/adapters/`)**
- Purpose: Client-specific logic for finding and patching third-party AI client config files
- Location: `cli/src/adapters/`
- Contains: One adapter class per supported client (Claude, Cursor, Cline, VS Code, Codex, OpenCode, Kiro, Qwen)
- Depends on: `cli/src/types.ts` (`ClientAdapter` interface), `cli/src/adapters/utils/index.ts`, `cli/src/util/fs.ts`
- Used by: `cli/src/core/sync.ts`
- Interface: Each adapter implements `ClientAdapter` with `detectConfigPath()`, `supportsHttp()`, `syncGateway()`

**Compatibility (`cli/src/compat/`)**
- Purpose: Pre-parsing layer that normalizes client-native CLI commands to canonical `mcpx add` format
- Location: `cli/src/compat/`
- Contains: Parsers for `claude mcp add`, `codex mcp add`, `code --add-mcp`, `qwen mcp add`
- Depends on: Nothing (pure argument parsing)
- Used by: `cli/src/cli.ts` (before Commander processes args)

**CLI Entry (`cli/src/cli.ts`)**
- Purpose: Commander-based CLI with all user-facing commands
- Location: `cli/src/cli.ts`
- Contains: Command registration, TUI status menu, argument parsing, output formatting
- Depends on: All core modules, adapters, compat layer

**Electron Main Process (`app/src/main/`)**
- Purpose: Electron app lifecycle, tray, dashboard window, IPC bridge to core
- Location: `app/src/main/`
- Contains: App bootstrap, tray management, window management, IPC handlers, registry client, server mapper, settings persistence, auto-updater
- Depends on: `@mcpx/core` (alias to `cli/src/core/index.ts`), Electron APIs

**Electron Preload (`app/src/preload/`)**
- Purpose: Secure context bridge exposing typed API from main to renderer
- Location: `app/src/preload/index.ts`
- Contains: `contextBridge.exposeInMainWorld("mcpx", api)` with IPC invoke wrappers
- Depends on: `app/src/shared/ipc-channels.ts`
- Used by: Renderer process via `window.mcpx`

**Electron Renderer (`app/src/renderer/`)**
- Purpose: React UI for the desktop dashboard
- Location: `app/src/renderer/`
- Contains: React components (Dashboard, BrowseTab, ServerCard, etc.), custom hooks, vanilla CSS
- Depends on: `window.mcpx` API exposed by preload
- State: Custom hooks (`useStatus`, `useRegistryList`) that call IPC methods

**Shared (`app/src/shared/`)**
- Purpose: Types and constants shared between main and renderer processes
- Location: `app/src/shared/`
- Contains: IPC channel name constants, desktop settings types

## Data Flow

**CLI Add Server:**

1. User runs `mcpx add <name> <url|command>` or a compat command like `mcpx claude mcp add ...`
2. `cli/src/compat/index.ts` normalizes client-native args to canonical format if needed
3. `cli/src/cli.ts` parses arguments via Commander, builds an `UpstreamServerSpec`
4. `cli/src/core/registry.ts` `addServer()` validates name and adds spec to config
5. `cli/src/core/config.ts` `saveConfig()` persists to `~/.config/mcpx/config.json`
6. `cli/src/core/sync.ts` `syncAllClients()` iterates all adapters, writing gateway entries to each client's config file

**Gateway Request Handling:**

1. AI client sends HTTP POST to `http://127.0.0.1:37373/mcp` with JSON-RPC body
2. `cli/src/gateway/server.ts` validates auth via `x-mcpx-local-token` header or Bearer token
3. Gateway parses JSON-RPC, resolves upstream server by `?upstream=` query param or namespaced tool name
4. For HTTP upstreams: gateway forwards JSON-RPC POST to upstream URL, resolving `secret://` refs in headers
5. For stdio upstreams: gateway manages persistent `StdioClientTransport` connections via `@modelcontextprotocol/sdk`, dispatching method calls
6. Response is returned as JSON or SSE depending on client Accept header

**Desktop App IPC Flow:**

1. Renderer calls `window.mcpx.addServer(name, spec)` (from preload API)
2. `app/src/preload/index.ts` invokes `ipcRenderer.invoke(IPC.ADD_SERVER, name, spec)`
3. `app/src/main/ipc-handlers.ts` receives the call, executes `addServer()` + `saveConfig()` + `syncAllClients()` from `@mcpx/core`
4. Result is returned to renderer via IPC promise resolution

**Registry Browse Flow (Desktop):**

1. Renderer calls `window.mcpx.registryList()` via `useRegistryList` hook
2. IPC handler in `app/src/main/ipc-handlers.ts` calls `fetchRegistryServers()` from `app/src/main/registry-client.ts`
3. Registry client fetches from `https://registry.modelcontextprotocol.io/v0.1/servers`
4. Results are filtered/sorted by `app/src/main/search-utils.ts` if a search query is provided
5. User selects a server, triggering `REGISTRY_PREPARE_ADD` which calls `selectBestPackage()` + `extractRequiredInputs()` from `app/src/main/server-mapper.ts`
6. After user provides required inputs, `REGISTRY_CONFIRM_ADD` maps to spec via `mapServerToSpec()` and calls `addServer()` + `syncAllClients()`

**State Management:**
- Core state: `~/.config/mcpx/config.json` (servers, gateway config, per-client sync state)
- Managed index: `~/.local/share/mcpx/managed-index.json` (tracks which entries mcpx owns in each client's config)
- Secret names index: `~/.local/share/mcpx/secret-names.json` (tracks keychain entry names)
- Runtime state: `~/.local/state/mcpx/runtime/daemon.pid` (PID file for daemon)
- Daemon logs: `~/.local/state/mcpx/logs/daemon.log`
- Desktop settings: Electron `userData` path (`settings.json`)

## Key Abstractions

**ClientAdapter (`cli/src/types.ts`):**
- Purpose: Uniform interface for syncing gateway configuration to any AI client
- Examples: `cli/src/adapters/claude.ts`, `cli/src/adapters/cursor.ts`, `cli/src/adapters/vscode.ts`
- Pattern: Each adapter implements `detectConfigPath()`, `supportsHttp()`, `syncGateway()`. The sync module iterates all adapters. Adapter utils (`cli/src/adapters/utils/index.ts`) provide shared helpers for managed entry tracking.

**UpstreamServerSpec (`cli/src/types.ts`):**
- Purpose: Discriminated union representing an MCP server connection (HTTP or stdio)
- Examples: Used throughout config, gateway, adapters
- Pattern: `{ transport: "http", url, headers? }` or `{ transport: "stdio", command, args?, env?, cwd? }`

**SecretsManager (`cli/src/core/secrets.ts`):**
- Purpose: Abstraction over macOS Keychain for credential storage
- Examples: Used in gateway (resolve secret refs in headers/env), daemon startup (gateway token), auth commands
- Pattern: Secrets referenced as `secret://<name>` in config values. `resolveMaybeSecret()` resolves at runtime. Supports env override via `MCPX_SECRET_<name>`.

**ManagedIndex (`cli/src/types.ts`, `cli/src/core/managed-index.ts`):**
- Purpose: Tracks which server entries in each client's config file are managed by mcpx
- Pattern: Each managed entry has a SHA-256 fingerprint. Before writing, adapters check that existing entries are either absent or managed. Stale entries (removed servers) are pruned automatically.

**GatewayRuntimeState (`cli/src/gateway/server.ts`):**
- Purpose: In-memory state for the running gateway server, tracking open stdio connections
- Pattern: `Map<string, StdioConnectionEntry>` keyed by server name, with fingerprint-based reconciliation on each request

## Entry Points

**CLI Binary:**
- Location: `cli/src/cli.ts` (compiled to `cli/dist/cli.js`, symlinked from `bin/mcpx`)
- Triggers: User runs `mcpx <command>` from terminal
- Responsibilities: All CLI commands (add, remove, sync, daemon, auth, status, secrets)

**Electron App:**
- Location: `app/src/main/index.ts`
- Triggers: User launches mcpx.app (or it starts at login)
- Responsibilities: Creates tray, registers IPC handlers, manages dashboard window, auto-starts daemon

**Daemon Child Mode:**
- Location: `app/src/main/daemon-child.ts`
- Triggers: `MCPX_DAEMON_CHILD=1` env var set (spawned by daemon start)
- Responsibilities: Runs the gateway HTTP server in foreground as a detached child process

**Gateway Server:**
- Location: `cli/src/gateway/server.ts` (`createGatewayServer()`)
- Triggers: Daemon start (CLI or desktop app)
- Responsibilities: Listens on `127.0.0.1:<port>`, proxies JSON-RPC to upstream servers

## Error Handling

**Strategy:** Errors are isolated per-operation. Adapter sync failures do not block other adapters. Upstream gateway errors do not crash the server.

**Patterns:**
- Adapter sync: Each adapter returns a `SyncResult` with status (`SYNCED`, `ERROR`, `UNSUPPORTED_HTTP`, `SKIPPED`) and optional error message. Errors are captured, not thrown.
- Gateway upstream calls: Errors from one upstream do not propagate to other upstreams. `isAuthChallenge()` is used to detect 401/403 and bubble them up as proxy auth challenges. Other errors are wrapped as JSON-RPC error responses.
- Config loading: Falls back to `defaultConfig()` if parse fails (never crashes on corrupt config).
- Secrets: `getSecret()` returns `null` on failure. `resolveMaybeSecret()` throws if a referenced secret is missing.
- Daemon: `stopDaemon()` ignores already-dead processes. PID file cleanup is best-effort.

## Cross-Cutting Concerns

**Logging:** `console.error` in gateway (gated by `MCPX_GATEWAY_DEBUG=1` env var). Daemon stdout/stderr redirect to log file at `~/.local/state/mcpx/logs/daemon.log`. Desktop app uses `console.error` with `[main]` prefix.

**Validation:** Zod schemas in `cli/src/core/config.ts` for config file parsing. Server names validated via regex in `cli/src/core/registry.ts`. No runtime validation in gateway for incoming JSON-RPC (relies on type assertions).

**Authentication:** Two-level auth model:
1. Local gateway auth: `x-mcpx-local-token` header or Bearer token (auto-generated, stored in Keychain)
2. Upstream server auth: `secret://` references in headers/env resolved at request time. OAuth well-known endpoints proxied for MCP Auth spec compliance.

**File I/O:** All JSON file writes use atomic write pattern (`writeJsonAtomic` in `cli/src/util/fs.ts`) -- write to temp file, then rename. File permissions set to `0o600` for sensitive files.

---

*Architecture analysis: 2026-03-09*
