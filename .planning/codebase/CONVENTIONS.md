# Coding Conventions

**Analysis Date:** 2026-03-09

## Naming Patterns

**Files:**
- Use kebab-case for all filenames: `auth-probe.ts`, `server-auth.ts`, `managed-index.ts`, `daemon-child.ts`
- React components use PascalCase: `ServerCard.tsx`, `BrowseTab.tsx`, `AddServerForm.tsx`
- Test files mirror source names with `.test.ts` / `.test.tsx` suffix: `sync.test.ts`, `Dashboard.test.tsx`
- Barrel exports use `index.ts`

**Functions:**
- Use camelCase: `loadConfig()`, `syncAllClients()`, `buildStatusReport()`, `parseCompatibilityArgs()`
- Boolean-returning helpers start with `is`/`has`/`supports`: `supportsHttp()`, `isHttpUrl()`, `isManagedEntry()`
- Factory/builder functions use `create`/`build`/`make` prefix: `createGatewayServer()`, `buildManagedEntries()`, `makeError()`, `makeResult()`
- Getters use `get`/`detect`/`resolve` prefix: `getConfigPath()`, `detectConfigPath()`, `resolveAuthTarget()`
- Validators use `validate` prefix: `validateServerName()`

**Variables:**
- Use camelCase for locals and parameters: `configPath`, `managedEntries`, `upstreamFilter`
- Constants use UPPER_SNAKE_CASE: `JSON_RPC_VERSION`, `DEFAULT_UPSTREAM_TIMEOUT_MS`, `OAUTH_WELL_KNOWN_PREFIXES`
- Exported constant arrays use UPPER_SNAKE_CASE: `STATUS_CLIENTS`

**Types:**
- Use PascalCase for interfaces and type aliases: `McpxConfig`, `SyncResult`, `DaemonStatus`
- Interfaces describe shape, no `I` prefix: `ClientAdapter`, `GatewayConfig`, `AuthTarget`
- Union literals use UPPER_SNAKE_CASE values: `"SYNCED" | "UNSUPPORTED_HTTP" | "ERROR" | "SKIPPED"`
- Type aliases for discriminated unions: `UpstreamServerSpec = HttpServerSpec | StdioServerSpec`

**Classes:**
- Use PascalCase: `SecretsManager`, `ClaudeAdapter`, `CursorAdapter`
- Class-based adapters implement `ClientAdapter` interface
- Readonly properties for identity fields: `readonly id = "claude" as const`

**IPC Channels:**
- Namespaced string constants: `"mcpx:get-status"`, `"mcpx:add-server"`
- Defined in a single const object `IPC` at `app/src/shared/ipc-channels.ts`

## Code Style

**Formatting:**
- No project-level Prettier or ESLint configuration. Formatting is consistent by convention.
- 2-space indentation throughout
- Double quotes for strings
- Semicolons always present
- Trailing commas in multiline object/array literals
- Max line length approximately 120-130 characters (not enforced)

**Linting:**
- No ESLint or Biome configuration at the project level
- TypeScript `strict: true` in all tsconfig files enforces type safety

**TypeScript Strictness:**
- All tsconfig files set `strict: true`
- `forceConsistentCasingInFileNames: true` in CLI tsconfig
- Target: `ES2022`, Module: `NodeNext` (CLI), `ESNext` (app)
- `skipLibCheck: true` everywhere

## Module System

**ESM Throughout:**
- `"type": "module"` in `cli/package.json`
- All imports use `.js` extension in CLI source: `import { loadConfig } from "./config.js"`
- App code uses bundler resolution (no `.js` extensions needed)

**Import Organization:**

**Order (CLI files):**
1. Node built-in modules: `import fs from "node:fs"`, `import path from "node:path"`
2. Third-party packages: `import { z } from "zod"`, `import { Command } from "commander"`
3. Internal relative imports: `import { loadConfig } from "./core/config.js"`
4. Type-only imports: `import type { McpxConfig } from "../types.js"`

**Order (App files):**
1. Node built-ins (main process only)
2. Electron/React imports: `import { app, ipcMain } from "electron"`
3. Core library imports: `import { loadConfig, saveConfig } from "@mcpx/core"`
4. Internal relative imports: `import { IPC } from "../shared/ipc-channels"`
5. Type-only imports

**Path Aliases:**
- `@mcpx/core` -> `cli/src/core/index.ts` (resolved by electron-vite, defined in `app/electron.vite.config.ts` and `app/tsconfig.node.json`)
- `@renderer/*` -> `app/src/renderer/*` (used in renderer process)

## Error Handling

**Patterns:**
- **Throw Error with descriptive message:** Functions that cannot recover throw `new Error("descriptive message")`
  ```typescript
  if (process.platform !== "darwin") {
    throw new Error("OS keychain integration is currently implemented for macOS only.");
  }
  ```
- **Return fallback on parse failure:** Config/data loading returns defaults when parsing fails instead of throwing
  ```typescript
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return defaultConfig();
  }
  ```
- **Result objects for sync operations:** Use status-based result types instead of exceptions
  ```typescript
  return errorResult(this.id, configPath, (error as Error).message);
  ```
- **Silent catch for cleanup:** Catch-and-ignore for non-critical cleanup operations
  ```typescript
  try { fs.unlinkSync(pidPath); } catch { /* Ignore cleanup failure. */ }
  ```
- **Error casting pattern:** Use `(error as Error).message` when catching unknown errors
- **Custom error classes:** `UpstreamHttpError` in `cli/src/gateway/server.ts` extends `Error` with additional fields (`status`, `bodyText`, `wwwAuthenticate`)

**JSON-RPC Error Pattern:**
- Errors returned as structured JSON-RPC response objects via `makeError(id, code, message, data?)`
- Standard codes: `-32600` (invalid request), `-32601` (method not found), `-32602` (invalid params), `-32000` (server error), `-32001` (unauthorized)

## Logging

**Framework:** `console.error` for daemon/gateway debug logging

**Patterns:**
- Debug logging gated by env var: `if (debug) { console.error(...) }` in `cli/src/gateway/server.ts`
- Debug messages prefixed with `[mcpx gateway]`
- Renderer uses `console.error("Registry search error:", err)` for non-critical async errors
- No structured logging framework

## Comments

**When to Comment:**
- Module-level JSDoc for public API surface (compat layer): `/** Detects client-native argv patterns... */`
- Inline comments explain "why" not "what": `// Upstream errors are isolated so one failed server does not break catalog.`
- `// Ignore ...` comments in silent catch blocks explain why the error is swallowed

**JSDoc/TSDoc:**
- Minimal usage. Present in `cli/src/compat/index.ts` for exported functions
- Not consistently applied across all modules
- Type information is conveyed through TypeScript types rather than JSDoc

## Function Design

**Size:** Functions are generally small (10-40 lines). Larger functions exist in `cli/src/gateway/server.ts` and `cli/src/cli.ts` but are structured with clear early returns.

**Parameters:**
- Use options objects for functions with many optional parameters
- Default parameter values for optional configuration: `loadConfig(configPath = getConfigPath())`
- Discriminated unions for transport-specific specs

**Return Values:**
- `string | null` for lookups that may fail: `getSecret()`, `detectConfigPath()`
- Result objects with status field for operations: `SyncResult`, `DaemonStartResult`
- `void` for mutation functions: `saveConfig()`, `addServer()`

## Module Design

**Exports:**
- Named exports exclusively. No default exports anywhere in the codebase.
- Export functions and types directly from modules
- Classes exported by name: `export class SecretsManager {}`

**Barrel Files:**
- `cli/src/core/index.ts` is the primary barrel export consumed by the desktop app
- Groups exports by domain with section comments: `// Config`, `// Daemon`, `// Sync`
- Re-exports types from `../types.js` for convenience
- `cli/src/adapters/index.ts` exports a factory function `getAdapters()` rather than individual classes

**Adapter Pattern:**
- Client adapters implement `ClientAdapter` interface from `cli/src/types.ts`
- Each adapter in its own file: `cli/src/adapters/claude.ts`, `cli/src/adapters/cursor.ts`
- Shared utilities in `cli/src/adapters/utils/index.ts` provide common result constructors: `okResult()`, `errorResult()`, `skippedResult()`

## Validation

**Zod for Configuration:**
- Zod schemas validate config at load time: `cli/src/core/config.ts`
- Use `z.discriminatedUnion()` for transport types
- Use `safeParse()` with fallback to defaults (never throws on invalid config)
- Zod v4 (`zod@^4.1.12`)

**Manual Validation for CLI Input:**
- Regex validation for server names: `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/`
- URL validation via `new URL()` constructor

## React Component Conventions

**Component Style:**
- Function components exclusively, no class components
- Props defined as inline interfaces at top of file (not exported unless reused)
- Return `JSX.Element` (explicit in `App.tsx`, implicit elsewhere)
- No prop destructuring in function signature; access via `props.name` pattern (e.g., `ServerCard`)

**State Management:**
- React `useState` and `useEffect` for local state
- Custom hooks in `app/src/renderer/hooks/`: `useStatus()`, `useRegistryList()`
- No external state management library (no Redux, Zustand, etc.)
- IPC bridge via `window.mcpx` global (typed via preload `contextBridge`)

**Styling:**
- Vanilla CSS in `app/src/renderer/index.css`
- Class names use kebab-case: `server-card`, `dashboard-container`, `page-header`
- BEM-like naming: `server-card-header`, `server-card-footer`, `server-card-status-error`
- Data attributes for active state: `data-active={tab === "servers"}`
- Inline styles only for layout overrides in loading states

## Atomic File Operations

- `writeJsonAtomic()` in `cli/src/util/fs.ts` writes to temp file then renames
- All JSON files written with `0o600` permissions
- JSON output formatted with 2-space indent and trailing newline

---

*Convention analysis: 2026-03-09*
