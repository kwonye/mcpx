# Codebase Concerns

**Analysis Date:** 2026-03-09

## Tech Debt

**Monolithic CLI entry point (1382 lines):**
- Issue: `cli/src/cli.ts` is 1382 lines and combines command registration, interactive TUI menus, output formatting, input prompting, and business logic orchestration in a single file.
- Files: `cli/src/cli.ts`
- Impact: Difficult to test individual commands in isolation. Interactive TUI code (keypress menus, terminal clearing) is entangled with command logic. Adding new commands requires modifying this massive file.
- Fix approach: Extract each top-level command into its own module under `cli/src/commands/` (e.g., `add.ts`, `status.ts`, `auth.ts`, `daemon.ts`). Extract the interactive menu/TUI rendering into `cli/src/ui/`. Keep `cli.ts` as a thin command registration shell.

**Duplicated argument parsing logic across compat modules and IPC handlers:**
- Issue: The `cli/src/compat/` modules (claude.ts, codex.ts, qwen.ts) each independently implement nearly identical flag-parsing and positional-argument extraction logic with the same structural patterns (parseFlags, extractPositionalArgs, validate, normalize). Additionally, `app/src/main/ipc-handlers.ts` re-implements its own `parseCliAddCommand` with `parseClaudeAdd`, `parseCodexAdd`, `parseQwenAdd`, `parseStandardAdd`, and `parseVSCodeAdd` functions (lines 52-285) that duplicate the CLI compat layer logic entirely.
- Files: `cli/src/compat/claude.ts`, `cli/src/compat/codex.ts`, `cli/src/compat/qwen.ts`, `cli/src/compat/vscode.ts`, `app/src/main/ipc-handlers.ts`
- Impact: Bug fixes or new client support must be applied in two places. The IPC handler versions lack the validation rigor of the CLI compat modules (e.g., no rejection of unsupported features like `--scope`).
- Fix approach: The app's `ipc-handlers.ts` should import and reuse `parseCompatibilityArgs` from `@mcpx/core` instead of maintaining a parallel parser. Add the compat module to the core barrel export.

**Duplicated utility functions:**
- Issue: `parseKeyValueFlag` and `isHttpUrl` are defined identically in both `cli/src/cli.ts` (lines 62-86) and `app/src/main/ipc-handlers.ts` (lines 35-50).
- Files: `cli/src/cli.ts`, `app/src/main/ipc-handlers.ts`
- Impact: Divergence risk; changes to one copy are not reflected in the other.
- Fix approach: Move shared utility functions to `cli/src/util/` and export them through `@mcpx/core`.

**Module-level mutable singleton state in IPC handlers:**
- Issue: `pendingAdd` in `app/src/main/ipc-handlers.ts` (line 29) stores state between `REGISTRY_PREPARE_ADD` and `REGISTRY_CONFIRM_ADD` calls as a module-level variable. This is fragile -- if the user navigates away or triggers a second prepare before confirming, the previous pending state is silently overwritten.
- Files: `app/src/main/ipc-handlers.ts` (line 29)
- Impact: Race condition in the UI where rapidly browsing and installing registry servers could install the wrong server.
- Fix approach: Use a unique operation ID returned from `REGISTRY_PREPARE_ADD` that must be passed back to `REGISTRY_CONFIRM_ADD` to validate the operation is still current.

**Untyped state in React hooks:**
- Issue: `useStatus()` in `app/src/renderer/hooks/useMcpx.ts` uses `useState<unknown>(null)` for status and `useRegistryList()` uses `useState<unknown[]>([])` for servers.
- Files: `app/src/renderer/hooks/useMcpx.ts`
- Impact: All consumers must cast or use `as any` to access properties, bypassing TypeScript safety. The deduplication filter at lines 44 and 74 uses `(s: any)`.
- Fix approach: Import or define proper types (e.g., `StatusReport`, `RegistryServerEntry`) and use typed state.

**Desktop settings store lacks atomic writes:**
- Issue: `app/src/main/settings-store.ts` uses `fs.writeFileSync` directly instead of the atomic write pattern (`writeJsonAtomic`) used elsewhere in the codebase.
- Files: `app/src/main/settings-store.ts` (line 33)
- Impact: Power loss or crash during write could corrupt the settings file. The core library's `writeJsonAtomic` in `cli/src/util/fs.ts` handles this correctly with temp-file-and-rename.
- Fix approach: Import and use `writeJsonAtomic` from `@mcpx/core` (it is already exported).

## Known Bugs

**`getDaemonStatus()` called without required `config` argument in desktop app:**
- Symptoms: TypeScript compilation error or runtime failure when checking daemon status at app startup.
- Files: `app/src/main/index.ts` (line 127)
- Trigger: App launch. `getDaemonStatus()` is called without arguments, but the function signature at `cli/src/core/daemon.ts:90` requires `config: McpxConfig`.
- Workaround: The TypeScript compiler may be masking this due to the path alias resolution or the call might work if `config` defaults to `undefined` and the function only uses `config.gateway.port` in the return value (which would still produce incorrect output). Every other call site passes `config`.

**Debug `console.log` left in production registry client:**
- Symptoms: `[fetchRegistryServers] fetching URL:` logged to console on every registry API call in the desktop app.
- Files: `app/src/main/registry-client.ts` (line 85)
- Trigger: Any search or browse action in the Browse tab.
- Workaround: Harmless but noisy; remove the line.

**`repository` field accessed in search-utils but not in RegistryServerEntry type:**
- Symptoms: TypeScript error or silent undefined access. `server.server.repository?.url` and `server.server.repository.subfolder` are accessed in search-utils, but `RegistryServerEntry["server"]` does not include a `repository` field.
- Files: `app/src/main/search-utils.ts` (lines 42-46, 114-118), `app/src/main/registry-client.ts` (type definition)
- Trigger: Search queries where repository URL would contribute to relevance scoring. The optional chaining prevents a crash, but the field is never matched.
- Workaround: Add `repository?: { url: string; subfolder?: string }` to the `RegistryServerEntry["server"]` type.

## Security Considerations

**Gateway token transmitted in cleartext over localhost HTTP:**
- Risk: The local gateway token is sent as a Bearer token or `x-mcpx-local-token` header over unencrypted HTTP to `127.0.0.1`. While localhost traffic is generally not sniffable, any process on the machine can connect to the gateway port and attempt brute-force or replay attacks.
- Files: `cli/src/gateway/server.ts` (lines 624-639), `cli/src/core/sync.ts` (line 26)
- Current mitigation: Token is 32 random bytes (base64url), gateway binds only to `127.0.0.1`.
- Recommendations: Consider rate-limiting failed auth attempts in the gateway. The 10MB body limit (line 1155) is good. Consider adding a nonce or session binding.

**Secret values passed as CLI arguments to `security` command:**
- Risk: `SecretsManager.setSecret()` passes the secret value as a command-line argument to `security add-generic-password -w <value>`. On macOS, command-line arguments are visible in `ps aux` output briefly during execution.
- Files: `cli/src/core/secrets.ts` (line 60)
- Current mitigation: `execFileSync` with `stdio: "ignore"` prevents output leakage, but the process argument list is briefly visible.
- Recommendations: Use stdin piping to pass the secret value to the `security` command instead of a command-line argument.

**Preload API exposes generic `invoke` passthrough:**
- Risk: `app/src/preload/index.ts` (line 21) exposes `invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)` which allows the renderer to call any IPC channel, not just the explicitly defined ones.
- Files: `app/src/preload/index.ts` (line 21)
- Current mitigation: The renderer is loaded from local files, not remote URLs.
- Recommendations: Remove the generic `invoke` passthrough. Only expose the explicitly typed API methods.

**No input validation on IPC handler parameters:**
- Risk: IPC handlers in `app/src/main/ipc-handlers.ts` accept parameters from the renderer process without validation. For example, `ADD_SERVER` accepts `(name: string, spec: UpstreamServerSpec)` but does not validate the spec shape.
- Files: `app/src/main/ipc-handlers.ts` (lines 314-321)
- Current mitigation: `addServer` calls `validateServerName`, and the config is validated by Zod on load. But malformed `spec` objects could bypass transport-specific validation.
- Recommendations: Validate IPC parameters with Zod schemas before processing.

## Performance Bottlenecks

**Sequential upstream calls in gateway list operations:**
- Problem: `handleListTools`, `handleListResources`, and `handleListPrompts` iterate over upstreams sequentially with `for...of` loops and `await` each call.
- Files: `cli/src/gateway/server.ts` (lines 661-701, 703-748, 750-793)
- Cause: Each upstream is called one after another. With N upstreams, latency is the sum of all upstream latencies.
- Improvement path: Use `Promise.allSettled` to call all upstreams in parallel, then collect results. This would reduce list latency from O(sum) to O(max).

**Config reloaded from disk on every JSON-RPC request:**
- Problem: `handleRequestObject` calls `loadConfig()` (which reads and JSON-parses the config file from disk) on every incoming request that is not `initialize`, `notifications/initialized`, or `ping`.
- Files: `cli/src/gateway/server.ts` (line 958)
- Cause: The gateway is designed to always reflect the latest config without restart, but this means every tool call or list operation triggers a disk read.
- Improvement path: Cache the config with a file-watcher or mtime-based invalidation. A simple approach: read the file's mtime before each request and only re-parse if changed.

**Daemon log reading loads entire file into memory:**
- Problem: `readDaemonLogs` reads the entire daemon log file into memory and then slices the last N lines.
- Files: `cli/src/core/daemon.ts` (lines 186-194)
- Cause: Uses `fs.readFileSync` on the full file then `split("\n").slice()`.
- Improvement path: For large log files, use a reverse-read approach or stream from the end. Currently the log file is append-only with no rotation, so it grows unbounded.

## Fragile Areas

**Client config file sync (adapter layer):**
- Files: `cli/src/adapters/claude.ts`, `cli/src/adapters/cursor.ts`, `cli/src/adapters/codex.ts`, `cli/src/adapters/cline.ts`, `cli/src/adapters/kiro.ts`, `cli/src/adapters/opencode.ts`, `cli/src/adapters/vscode.ts`, `cli/src/adapters/qwen.ts`
- Why fragile: Each adapter reads and writes to third-party application config files (e.g., `~/.claude.json`, VS Code `settings.json`, Cursor's `mcp.json`). These config file formats are not versioned or documented by the upstream clients. Any upstream client update that changes config format could silently break sync. The adapters also have no file locking -- concurrent writes (e.g., from the client itself and mcpx simultaneously) could corrupt the file.
- Safe modification: Always test sync against actual client installations. Use the `managedIndex` fingerprint system to detect externally modified entries. Add integration tests that verify round-trip read-write with sample config files.
- Test coverage: `cli/test/sync.test.ts` (229 lines) tests the sync orchestration but not individual adapter write logic in depth. No tests for concurrent write scenarios.

**Stdio connection lifecycle in gateway:**
- Files: `cli/src/gateway/server.ts` (lines 308-442)
- Why fragile: The stdio connection pool uses a `Map<string, StdioConnectionEntry>` where each entry holds a `Promise<StdioConnection>`. Connections are fingerprinted by JSON-serializing the entire spec. A race condition exists: if two requests arrive simultaneously for the same upstream and the first connection attempt is still pending, the second request will reuse the pending promise, which is correct. However, if a connection fails, it is deleted from the map (line 396) and the next request will retry. But if the connection's `client.connect()` hangs indefinitely (despite the timeout), the entry stays in the map and all subsequent requests share the stuck promise.
- Safe modification: Ensure the `withTimeout` wrapper on `client.connect` (line 375) always resolves or rejects. Add health-check pings for long-lived stdio connections.
- Test coverage: `cli/test/gateway.test.ts` (638 lines) covers HTTP proxying but stdio connection pooling edge cases are not covered.

**Interactive TUI menu in CLI:**
- Files: `cli/src/cli.ts` (lines 329-600+)
- Why fragile: The `promptMenuSelection` function manipulates raw terminal mode, emits keypress events, and clears the terminal screen. It has two code paths (raw mode for TTY, fallback numeric input for non-TTY). Terminal state cleanup relies on `finally` blocks, but unhandled exceptions or signals during raw mode could leave the terminal in a broken state.
- Safe modification: Always test in both TTY and non-TTY environments. The `finally` block at the end must restore raw mode and remove keypress listeners.
- Test coverage: No tests for the interactive TUI. This code is untestable without terminal mocking infrastructure.

## Scaling Limits

**Single-process daemon architecture:**
- Current capacity: One daemon process per machine, one HTTP server on one port.
- Limit: All upstream connections are managed in a single Node.js process. Stdio connections hold child processes. With many upstreams (20+), the daemon could hit file descriptor limits or memory pressure from concurrent child processes.
- Scaling path: The architecture is appropriate for personal/developer use. For multi-user or team scenarios, consider process-per-upstream isolation or connection limits.

**No daemon log rotation:**
- Current capacity: Daemon log file grows indefinitely at `~/.local/state/mcpx/logs/daemon.log`.
- Limit: Disk space. After weeks/months of continuous daemon operation, the log file could grow to gigabytes.
- Scaling path: Implement log rotation (e.g., rotate at 10MB, keep 3 files) in the daemon's write logic, or truncate on daemon restart.

## Dependencies at Risk

**macOS-only keychain integration:**
- Risk: `SecretsManager` in `cli/src/core/secrets.ts` is hardcoded to macOS `security` CLI commands. On non-macOS platforms, `setSecret` throws and `getSecret` returns null (with an env var fallback).
- Impact: The entire product (CLI and desktop app) is macOS-only for secret storage. Linux and Windows users cannot use secrets features.
- Migration plan: Abstract the keychain backend behind a platform interface. Use `keytar` or platform-specific implementations (Windows Credential Manager, Linux Secret Service).

**Tight coupling to `@modelcontextprotocol/sdk`:**
- Risk: The MCP SDK is used for stdio client transport in the gateway (`cli/src/gateway/server.ts`). The SDK's `Client` and `StdioClientTransport` classes are the sole interface to upstream stdio servers. Breaking changes in the SDK would require gateway modifications.
- Impact: Protocol version changes could break compatibility with existing upstream servers.
- Migration plan: Pin SDK version carefully. The gateway already handles `protocolVersion` negotiation flexibly (line 932).

## Missing Critical Features

**No graceful shutdown for stdio child processes:**
- Problem: When the daemon stops, `closeStdioConnection` (line 308) calls `transport.close()` but swallows all errors. There is no SIGTERM/SIGKILL cascade or timeout for zombie child processes.
- Blocks: Clean daemon restarts. Zombie stdio server processes could accumulate.

**No health monitoring for upstream connections:**
- Problem: The gateway has no periodic health checks for upstream servers. A dead upstream is only detected when a client makes a request that times out.
- Blocks: Proactive error reporting. The status report only checks daemon PID, not upstream reachability.

## Test Coverage Gaps

**No tests for CLI command handlers:**
- What's not tested: The actual command execution paths in `cli/src/cli.ts` -- add, remove, auth set/remove, status, daemon start/stop/restart.
- Files: `cli/src/cli.ts`
- Risk: Regressions in command argument parsing, output formatting, or error handling go undetected. The 1382-line file has only one test file (`cli/test/compat.test.ts`) that tests the compat layer, not the command handlers themselves.
- Priority: High

**No tests for IPC handlers:**
- What's not tested: The entire `app/src/main/ipc-handlers.ts` including its duplicated CLI parsing, registry prepare/confirm flow, and the `pendingAdd` state management.
- Files: `app/src/main/ipc-handlers.ts`
- Risk: The duplicated parsing logic could diverge from the CLI compat layer. The `pendingAdd` race condition is untested.
- Priority: High

**No tests for adapter write logic:**
- What's not tested: Individual adapter `syncGateway` methods are not tested with realistic config file contents. The sync test (`cli/test/sync.test.ts`) tests orchestration but uses mocks.
- Files: `cli/src/adapters/claude.ts`, `cli/src/adapters/cursor.ts`, `cli/src/adapters/codex.ts`, `cli/src/adapters/cline.ts`, `cli/src/adapters/kiro.ts`, `cli/src/adapters/opencode.ts`, `cli/src/adapters/vscode.ts`, `cli/src/adapters/qwen.ts`
- Risk: Config file corruption or incorrect merge behavior when syncing with real client config files.
- Priority: Medium

**No tests for stdio connection pooling in gateway:**
- What's not tested: Connection reuse, stale connection cleanup, concurrent request handling, connection failure recovery.
- Files: `cli/src/gateway/server.ts` (lines 308-442)
- Risk: Connection leaks, zombie processes, or request failures under concurrent load.
- Priority: Medium

**Minimal E2E coverage:**
- What's not tested: Only one E2E spec exists (`app/e2e/app-launch.spec.ts`). No E2E tests for the Browse tab, server add/remove flow, daemon start/stop, or settings changes.
- Files: `app/e2e/app-launch.spec.ts`
- Risk: Full user workflows are untested end-to-end. UI regressions in the dashboard or browse tab go undetected.
- Priority: Low (unit tests cover most logic)

---

*Concerns audit: 2026-03-09*
