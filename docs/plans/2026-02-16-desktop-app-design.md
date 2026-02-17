# mcpx Desktop App Design

## Summary

A macOS Electron desktop app that provides visual status monitoring and non-technical onboarding for mcpx. Menubar tray icon with a detachable full dashboard window. Lives alongside the CLI in a monorepo at `app/`, with existing CLI code moved to `cli/`.

## Repo Structure

```
mcpx/
├── cli/                          # Current src/, test/, package.json moved here
│   ├── src/
│   │   ├── cli.ts                # CLI entry point (commander wrapper)
│   │   ├── core/                 # Shared business logic
│   │   │   ├── index.ts          # Barrel export for core public API
│   │   │   ├── config.ts
│   │   │   ├── daemon.ts
│   │   │   ├── registry.ts
│   │   │   ├── secrets.ts
│   │   │   ├── server-auth.ts
│   │   │   ├── status.ts
│   │   │   ├── sync.ts
│   │   │   └── ...
│   │   ├── adapters/
│   │   ├── gateway/
│   │   └── types.ts
│   ├── test/
│   ├── package.json              # @kwonye/mcpx, exports "./core" entry
│   └── tsconfig.json
├── app/                          # Electron desktop app
│   ├── src/
│   │   ├── main/                 # Electron main process
│   │   │   ├── index.ts          # App entry, tray + IPC setup
│   │   │   ├── tray.ts           # Tray icon, popover window
│   │   │   ├── dashboard.ts      # Dashboard window lifecycle
│   │   │   ├── ipc-handlers.ts   # IPC bridge to core modules
│   │   │   └── registry-client.ts # MCP Registry API client
│   │   ├── renderer/             # React UI
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── StatusPopover.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── ServerCard.tsx
│   │   │   │   ├── ServerDetail.tsx
│   │   │   │   ├── AddServerForm.tsx
│   │   │   │   ├── BrowseTab.tsx
│   │   │   │   └── DaemonControls.tsx
│   │   │   └── hooks/
│   │   │       └── useMcpx.ts    # IPC wrapper hooks
│   │   └── shared/               # Types shared between main/renderer
│   ├── resources/                # Icons, assets
│   ├── package.json              # Private, not npm-published
│   └── tsconfig.json
├── .gitignore
└── README.md
```

No root `package.json`. Two independent packages with separate `npm install` and build pipelines. The app imports core modules from the cli package via npm workspaces or TypeScript path mapping.

## Integration: Shared Core Modules

The cli `package.json` exports core modules so the desktop app can import them directly:

```json
{
  "exports": {
    ".": "./dist/cli.js",
    "./core": "./dist/core/index.js"
  }
}
```

The Electron main process imports core functions (`loadConfig`, `buildStatusReport`, `syncAllClients`, `SecretsManager`, `startDaemon`, etc.) and exposes them to the renderer via IPC handlers.

```
renderer -> IPC -> main process -> core module function call -> IPC -> renderer
```

No child processes, no JSON parsing. Direct function calls with shared TypeScript types. The CLI and desktop app are two presentation layers over the same core.

## App UX

### Menubar Tray

- Always-visible tray icon in macOS menubar
- Icon color/variant indicates daemon health: green (running), yellow (degraded), red (down)
- Click opens a popover panel

### Popover Panel

- Daemon status line: "Gateway running on :37373" or "Gateway stopped"
- Server summary: "4 servers, 7 clients synced, 0 errors"
- Red error badge if errors exist
- Buttons: "Open Dashboard", "Sync All", "Restart Daemon"

### Dashboard Window

Standard macOS window, opens from popover or dock icon. Three main views:

**Server List (main view):**
- Cards for each configured upstream server
- Each card: name, transport, target, auth status icon, synced client icons
- Click to expand/navigate to detail
- "Add Server" button

**Server Detail:**
- Full server info: name, transport, target
- Auth bindings: headers/env vars configured, secret references
- Client sync table: per-client sync status, config path, last synced timestamp
- Actions: Configure Auth, Re-authenticate, Clear Auth, Remove Server

**Browse Tab:**
- Powered by the official MCP Registry (`registry.modelcontextprotocol.io`)
- No API key required (public read endpoints)
- Search/filter bar
- Server cards: title, description, package type, transport
- Cursor-based pagination (load more)
- "Add" button on each card

**Settings:**
- Gateway port
- Auto-start daemon toggle
- Client enable/disable toggles
- Rotate local gateway token

## Browse: One-Click Add Flow

Design principle: hide as much complexity from the user as possible.

1. User clicks "Add" on a server card in the browse tab
2. App fetches the `latest` version from `GET /v0.1/servers/{name}/versions/latest`
3. App auto-selects the best package/remote (npm stdio > pypi stdio > remote HTTP > docker)
4. If no required inputs: server is added immediately, auto-synced, success toast. Done.
5. If required inputs exist: a single form shows only required fields:
   - Secret fields (`isSecret: true`) get a password input, stored in keychain automatically
   - Required arguments get a text input or folder picker
   - Labels come from `server.json` descriptions
6. User fills in fields, clicks "Add". Done.

The user never sees: transport type, package registry, runtime hints, secret ref names, `UpstreamServerSpec` internals.

### server.json to UpstreamServerSpec Mapping

| server.json | mcpx spec |
|---|---|
| `packages[].transport.type === "stdio"` (npm) | `{ transport: "stdio", command: "npx", args: ["pkg@version", ...packageArguments] }` |
| `packages[].transport.type === "stdio"` (pypi) | `{ transport: "stdio", command: "uvx", args: ["pkg", ...packageArguments] }` |
| `remotes[].type === "streamable-http"` | `{ transport: "http", url: remotes[].url }` |
| `packages[].environmentVariables` (isSecret) | Stored in keychain via SecretsManager, referenced as `secret://` |
| `remotes[].headers` (isSecret) | Stored in keychain via SecretsManager, referenced as `secret://` |

### MCP Registry API Endpoints Used

- `GET /v0.1/servers?limit=30&cursor=<cursor>` — paginated server list for browsing
- `GET /v0.1/servers/{name}/versions/latest` — full server detail for the add flow

No authentication required.

## Testing

### CLI core modules
Existing vitest suite in `cli/test/`. Unchanged.

### Electron main process (vitest)
- Registry API client: mock HTTP responses, verify `server.json` parsing
- `server.json` to `UpstreamServerSpec` mapping: auto-selection logic, env var extraction, secret detection
- IPC handlers: mock core module calls, verify correct arguments

### Renderer components (vitest + React Testing Library)
- `ServerCard`: renders name, description, "Add" button
- `AddServerForm`: shows required fields only, submits correct values
- `StatusPopover`: daemon state, server count, error badges
- `Dashboard`: server list renders, drill-into-detail navigation
- `DaemonControls`: start/stop/restart trigger correct IPC calls

### E2E (Playwright + Electron)
- Browse and add: open browse tab, find server, click Add, verify in server list
- Status popover: click tray, verify daemon state and server count
- Auth flow: add server requiring auth, fill secret field, verify stored
- Dashboard navigation: server list -> detail -> back

## Decisions

- **Electron over Tauri**: battle-tested for menubar + window pattern, same language as core (TypeScript)
- **Monorepo over separate repo**: shared core modules, shared types, atomic changes
- **No root workspace package.json**: toolchains are different enough that independent packages are cleaner
- **Shared modules over shell-out**: no child process overhead, compile-time type safety, app is self-contained
- **Official MCP Registry over Smithery/PulseMCP/Glama**: open API, no auth required, community standard, rich server.json schema
- **One-click add**: auto-select best package, only prompt for required inputs, hide all internals
