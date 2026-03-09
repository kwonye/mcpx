# Codebase Structure

**Analysis Date:** 2026-03-09

## Directory Layout

```
mcpx/
├── cli/                        # CLI package (@kwonye/mcpx)
│   ├── src/
│   │   ├── cli.ts              # CLI entry point (Commander commands)
│   │   ├── types.ts            # Shared TypeScript types
│   │   ├── version.ts          # APP_VERSION constant
│   │   ├── core/               # Core business logic (shared with app)
│   │   │   ├── index.ts        # Barrel export (@mcpx/core entry)
│   │   │   ├── config.ts       # Config load/save with Zod validation
│   │   │   ├── daemon.ts       # Daemon lifecycle (start/stop/status)
│   │   │   ├── sync.ts         # Multi-client sync orchestration
│   │   │   ├── registry.ts     # Server add/remove operations
│   │   │   ├── secrets.ts      # SecretsManager (macOS Keychain)
│   │   │   ├── server-auth.ts  # Auth target/binding management
│   │   │   ├── status.ts       # Status report builder
│   │   │   ├── auth-probe.ts   # HTTP auth requirement detection
│   │   │   ├── managed-index.ts # Managed entry tracking
│   │   │   └── paths.ts        # XDG-compliant path resolution
│   │   ├── gateway/
│   │   │   └── server.ts       # HTTP gateway server (JSON-RPC proxy)
│   │   ├── adapters/           # Client-specific sync adapters
│   │   │   ├── index.ts        # Adapter factory (getAdapters())
│   │   │   ├── claude.ts       # Claude Desktop adapter
│   │   │   ├── cursor.ts       # Cursor adapter
│   │   │   ├── cline.ts        # Cline adapter
│   │   │   ├── codex.ts        # OpenAI Codex adapter
│   │   │   ├── vscode.ts       # VS Code adapter
│   │   │   ├── opencode.ts     # OpenCode adapter
│   │   │   ├── kiro.ts         # Kiro adapter
│   │   │   ├── qwen.ts         # Qwen CLI adapter
│   │   │   └── utils/
│   │   │       └── index.ts    # Shared adapter helpers
│   │   ├── compat/             # Client-native command compatibility
│   │   │   ├── index.ts        # Compatibility dispatcher
│   │   │   ├── claude.ts       # claude mcp add parser
│   │   │   ├── codex.ts        # codex mcp add parser
│   │   │   ├── vscode.ts       # code --add-mcp parser
│   │   │   ├── qwen.ts         # qwen mcp add parser
│   │   │   └── unsupported.ts  # Unsupported client detection
│   │   └── util/
│   │       └── fs.ts           # File I/O helpers (atomic write, JSON read)
│   ├── test/                   # CLI unit and integration tests
│   │   └── fixtures/           # Test fixture files
│   ├── scripts/                # Build/release scripts
│   ├── dist/                   # Compiled output (gitignored)
│   ├── package.json
│   └── tsconfig.json
│
├── app/                        # Desktop app (Electron + React)
│   ├── src/
│   │   ├── main/               # Electron main process
│   │   │   ├── index.ts        # App bootstrap and lifecycle
│   │   │   ├── tray.ts         # macOS menubar tray
│   │   │   ├── dashboard.ts    # Dashboard BrowserWindow management
│   │   │   ├── ipc-handlers.ts # IPC bridge (main <-> renderer)
│   │   │   ├── daemon-child.ts # Daemon child process mode
│   │   │   ├── registry-client.ts  # MCP Registry API client
│   │   │   ├── server-mapper.ts    # Registry package -> UpstreamServerSpec
│   │   │   ├── search-utils.ts     # Client-side search filtering/ranking
│   │   │   ├── settings-store.ts   # Desktop settings persistence
│   │   │   ├── login-item.ts       # macOS login item management
│   │   │   └── update-manager.ts   # Auto-updater (electron-updater)
│   │   ├── preload/
│   │   │   └── index.ts        # Context bridge (mcpx API for renderer)
│   │   ├── renderer/
│   │   │   ├── main.tsx         # React app mount point
│   │   │   ├── App.tsx          # Root component (popover vs dashboard)
│   │   │   ├── env.d.ts         # window.mcpx type declaration
│   │   │   ├── components/
│   │   │   │   ├── Dashboard.tsx     # Main dashboard with tabs
│   │   │   │   ├── ServerCard.tsx    # Server grid card
│   │   │   │   ├── ServerDetail.tsx  # Server detail view
│   │   │   │   ├── AddServerForm.tsx # Manual server add form
│   │   │   │   ├── BrowseTab.tsx     # Registry browse/install
│   │   │   │   ├── DaemonControls.tsx # Daemon start/stop/restart
│   │   │   │   ├── SettingsPanel.tsx  # Settings UI
│   │   │   │   ├── StatusPopover.tsx  # Tray status popover
│   │   │   │   └── CliCommandInput.tsx # CLI command paste input
│   │   │   └── hooks/
│   │   │       └── useMcpx.ts   # Custom hooks (useStatus, useRegistryList)
│   │   └── shared/
│   │       ├── ipc-channels.ts  # IPC channel name constants
│   │       └── desktop-settings.ts # Settings types and defaults
│   ├── test/
│   │   ├── components/          # Component tests (Vitest + RTL)
│   │   └── main/                # Main process unit tests
│   ├── e2e/                     # Playwright E2E tests
│   ├── resources/               # Static assets (tray icon)
│   ├── electron.vite.config.ts  # Build config with @mcpx/core alias
│   ├── vitest.config.ts
│   ├── playwright.config.ts
│   ├── package.json
│   ├── tsconfig.json            # Base config
│   ├── tsconfig.node.json       # Main/preload process config
│   └── tsconfig.web.json        # Renderer process config
│
├── bin/
│   ├── mcpx -> ../dist/cli.js                               # CLI symlink
│   └── mcpx-desktop -> ../app/dist/mac-arm64/mcpx.app/...   # Desktop symlink
│
├── .github/
│   ├── scripts/                 # CI helper scripts
│   └── workflows/               # CI/CD workflows
│
├── AGENTS.md                    # Project instructions (agent-facing)
├── CLAUDE.md -> AGENTS.md       # Symlink for Claude compatibility
├── LICENSE
└── README.md
```

## Directory Purposes

**`cli/src/core/`:**
- Purpose: Shared business logic consumed by both CLI and desktop app
- Contains: Config management, daemon lifecycle, sync orchestration, secrets, auth, status, paths
- Key files: `config.ts` (Zod-validated config), `daemon.ts` (daemon lifecycle), `sync.ts` (multi-client sync), `index.ts` (barrel export)

**`cli/src/gateway/`:**
- Purpose: HTTP gateway server implementation
- Contains: Single file `server.ts` with all gateway logic (~1268 lines)
- Key files: `server.ts` (createGatewayServer, JSON-RPC handling, upstream routing)

**`cli/src/adapters/`:**
- Purpose: One adapter class per supported AI client
- Contains: Client-specific config file detection and patching logic
- Key files: `index.ts` (factory), `utils/index.ts` (shared helpers for managed entries)

**`cli/src/compat/`:**
- Purpose: Argument pre-parsing for client-native MCP add commands
- Contains: Parser per client, plus unsupported client detection
- Key files: `index.ts` (dispatcher), individual parsers

**`cli/src/util/`:**
- Purpose: Low-level file utilities
- Contains: Atomic JSON write, SHA-256 hashing, safe file read
- Key files: `fs.ts`

**`app/src/main/`:**
- Purpose: Electron main process modules
- Contains: App lifecycle, tray, windows, IPC handlers, registry integration, settings
- Key files: `index.ts` (bootstrap), `ipc-handlers.ts` (IPC bridge), `registry-client.ts` (registry API), `server-mapper.ts` (registry-to-spec mapping)

**`app/src/preload/`:**
- Purpose: Electron context bridge
- Contains: Single file exposing typed `window.mcpx` API
- Key files: `index.ts`

**`app/src/renderer/`:**
- Purpose: React UI for the desktop dashboard
- Contains: Components, hooks, vanilla CSS
- Key files: `App.tsx` (root), `components/Dashboard.tsx` (main view), `hooks/useMcpx.ts` (data fetching)

**`app/src/shared/`:**
- Purpose: Types and constants shared between Electron processes
- Contains: IPC channel names, desktop settings types
- Key files: `ipc-channels.ts`, `desktop-settings.ts`

## Key File Locations

**Entry Points:**
- `cli/src/cli.ts`: CLI binary entry point (compiled to `cli/dist/cli.js`)
- `app/src/main/index.ts`: Electron app entry point
- `app/src/preload/index.ts`: Preload script entry
- `app/src/renderer/main.tsx`: React app mount point
- `cli/src/gateway/server.ts`: Gateway server factory (`createGatewayServer()`)

**Configuration:**
- `cli/src/core/config.ts`: Config schema and load/save
- `cli/src/core/paths.ts`: All file path resolution (XDG-compliant)
- `app/electron.vite.config.ts`: Build configuration with `@mcpx/core` alias definition
- `cli/tsconfig.json`: CLI TypeScript config
- `app/tsconfig.json`: App base TypeScript config

**Core Logic:**
- `cli/src/core/daemon.ts`: Daemon start/stop/status/restart
- `cli/src/core/sync.ts`: Sync orchestration across all client adapters
- `cli/src/core/registry.ts`: Server add/remove and gateway token management
- `cli/src/core/secrets.ts`: SecretsManager class (Keychain integration)
- `cli/src/core/server-auth.ts`: Auth binding management (secret refs in headers/env)
- `cli/src/core/status.ts`: Status report generation
- `cli/src/core/index.ts`: Barrel export (defines the `@mcpx/core` public API)

**Types:**
- `cli/src/types.ts`: All shared TypeScript interfaces (McpxConfig, ClientAdapter, UpstreamServerSpec, etc.)
- `app/src/shared/ipc-channels.ts`: IPC channel constants
- `app/src/shared/desktop-settings.ts`: Desktop settings types

**Testing:**
- `cli/test/`: CLI unit and integration tests
- `app/test/components/`: React component tests
- `app/test/main/`: Electron main process tests
- `app/e2e/`: Playwright E2E tests

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source files: `daemon-child.ts`, `server-mapper.ts`, `auth-probe.ts`
- `PascalCase.tsx` for React components: `Dashboard.tsx`, `ServerCard.tsx`, `BrowseTab.tsx`
- `camelCase.ts` for hooks: `useMcpx.ts`
- `index.ts` for barrel exports and module entry points

**Directories:**
- `kebab-case` for all directories: `adapters/`, `renderer/`, `ipc-channels`
- Singular form preferred: `core/`, `gateway/`, `util/` (not `utils/` except for `adapters/utils/`)

**Classes:**
- `PascalCase` with descriptive suffix: `ClaudeAdapter`, `SecretsManager`, `CursorAdapter`

**Functions:**
- `camelCase`: `loadConfig()`, `syncAllClients()`, `buildStatusReport()`

**Constants:**
- `UPPER_SNAKE_CASE` for module-level constants: `STATUS_CLIENTS`, `DEFAULT_UPSTREAM_TIMEOUT_MS`
- `PascalCase` for IPC channel map: `IPC.GET_STATUS`, `IPC.DAEMON_START`

**Types/Interfaces:**
- `PascalCase`: `McpxConfig`, `ClientAdapter`, `UpstreamServerSpec`, `SyncResult`

## Where to Add New Code

**New CLI Command:**
- Add command definition in `cli/src/cli.ts` using Commander `.command()` chain
- If the command needs new core logic, add it in `cli/src/core/` and export from `cli/src/core/index.ts`

**New Client Adapter:**
- Create `cli/src/adapters/<client>.ts` implementing `ClientAdapter` interface from `cli/src/types.ts`
- Add the adapter class to `getAdapters()` in `cli/src/adapters/index.ts`
- Add the client ID to the `ClientId` union in `cli/src/types.ts`
- Add to `STATUS_CLIENTS` array in `cli/src/core/status.ts`

**New Compat Parser (client-native command):**
- Create `cli/src/compat/<client>.ts` with a `parse<Client>Args()` function
- Register the pattern in `cli/src/compat/index.ts` `parseCompatibilityArgs()`

**New Core Module:**
- Add file in `cli/src/core/<module>.ts`
- Export from `cli/src/core/index.ts` to make it available to the desktop app via `@mcpx/core`
- Add tests in `cli/test/`

**New React Component:**
- Create `app/src/renderer/components/<ComponentName>.tsx`
- Use vanilla CSS (no CSS-in-JS or utility frameworks)
- Access backend via `window.mcpx.<method>()` (defined in preload)
- Add component tests in `app/test/components/`

**New IPC Channel:**
- Add channel name to `app/src/shared/ipc-channels.ts` in the `IPC` const
- Add handler in `app/src/main/ipc-handlers.ts` using `ipcMain.handle(IPC.<CHANNEL>, ...)`
- Add API method in `app/src/preload/index.ts` in the `api` object
- Call from renderer via `window.mcpx.<methodName>()`

**New Custom Hook:**
- Create in `app/src/renderer/hooks/use<Name>.ts`
- Follow the pattern from `app/src/renderer/hooks/useMcpx.ts`

**New Utility Function:**
- CLI utilities: `cli/src/util/fs.ts` (or create new file in `cli/src/util/`)
- Adapter shared helpers: `cli/src/adapters/utils/index.ts`

## Special Directories

**`cli/dist/`:**
- Purpose: Compiled CLI output
- Generated: Yes (by `npm run build` in `cli/`)
- Committed: No (gitignored)

**`app/dist/`:**
- Purpose: Compiled Electron app output
- Generated: Yes (by `npm run build` in `app/`)
- Committed: No (gitignored)

**`app/out/`:**
- Purpose: Electron builder output (packaged .app)
- Generated: Yes (by electron-builder)
- Committed: No (gitignored)

**`app/resources/`:**
- Purpose: Static assets for the Electron app (tray icon template)
- Generated: No
- Committed: Yes

**`bin/`:**
- Purpose: Symlinks to compiled binaries for local development
- Generated: No (manually maintained symlinks)
- Committed: Yes

**`.github/`:**
- Purpose: CI/CD workflows and helper scripts
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: Yes (by GSD commands)
- Committed: Yes

---

*Structure analysis: 2026-03-09*
