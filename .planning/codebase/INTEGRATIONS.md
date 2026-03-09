# External Integrations

**Analysis Date:** 2026-03-09

## APIs & External Services

**MCP Registry (read-only):**
- Service: Official MCP server registry at `https://registry.modelcontextprotocol.io`
- Used for: Server discovery and installation in the desktop app's Browse tab
- Client: Raw `fetch()` calls in `app/src/main/registry-client.ts`
- Auth: None (public API)
- Endpoints consumed:
  - `GET /v0.1/servers?limit=N&cursor=C&search=Q` - List/search servers
  - `GET /v0.1/servers/{name}/versions/latest` - Get server detail with packages and remotes

**Upstream MCP Servers (user-configured):**
- Service: Any MCP-compatible server (HTTP or stdio transport)
- Used for: Proxying JSON-RPC requests from AI clients through the local gateway
- Client: `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` for stdio servers; raw `fetch()` for HTTP servers
- Implementation: `cli/src/gateway/server.ts`
- Auth: Per-server via `secret://` references in config headers/env, resolved at runtime from keychain
- Protocol: JSON-RPC 2.0 over HTTP POST or stdio pipes. Supports both `application/json` and `text/event-stream` (SSE) responses.

**OAuth Proxy (pass-through):**
- The gateway transparently proxies OAuth well-known discovery endpoints for upstream HTTP servers:
  - `/.well-known/oauth-protected-resource`
  - `/.well-known/oauth-authorization-server`
  - `/.well-known/openid-configuration`
- Implementation: `cli/src/gateway/server.ts` (`maybeHandleWellKnownOAuthRequest`)
- Rewrites `resource_metadata` URLs to point back to the local gateway, enabling OAuth flows that route through mcpx

## Data Storage

**Databases:**
- None. All state is file-based JSON.

**Configuration Store:**
- `~/.config/mcpx/config.json` - Central config (servers, gateway settings, client sync state)
  - Read/written by: `cli/src/core/config.ts` (`loadConfig`, `saveConfig`)
  - Schema: Zod-validated in `cli/src/core/config.ts` (`configSchema`)
  - Atomic writes: `cli/src/util/fs.ts` (`writeJsonAtomic` - write to temp file then rename)

**Managed Index:**
- `~/.local/share/mcpx/managed-index.json` - Tracks which config entries mcpx owns in each AI client
  - Read/written by: `cli/src/core/managed-index.ts`
  - Purpose: Prevents mcpx from overwriting user-created entries, enables cleanup of stale entries

**Secret Name Index:**
- `~/.local/share/mcpx/secret-names.json` - Lists all secret names stored in keychain
  - Read/written by: `cli/src/core/secrets.ts` (`SecretsManager`)
  - Purpose: Allows enumeration of secrets without querying keychain directly

**Desktop Settings:**
- `{app.getPath("userData")}/settings.json` - Desktop app preferences
  - Read/written by: `app/src/main/settings-store.ts`
  - Contains: `autoUpdateEnabled`, `startOnLoginEnabled`

**File Storage:**
- Local filesystem only. No cloud storage.

**Caching:**
- None. Config is re-read from disk on each gateway request (`loadConfig()` called per request in `cli/src/gateway/server.ts`).

## Authentication & Identity

**macOS Keychain:**
- Provider: macOS native Keychain via `security` CLI tool
- Implementation: `cli/src/core/secrets.ts` (`SecretsManager`)
- Service name: `mcpx` (used as Keychain service identifier)
- Operations:
  - `setSecret(name, value)` - `security add-generic-password -U -a {name} -s mcpx -w {value}`
  - `getSecret(name)` - `security find-generic-password -w -a {name} -s mcpx`
  - `removeSecret(name)` - `security delete-generic-password -a {name} -s mcpx`
- Fallback: `MCPX_SECRET_{name}` environment variable override (checked before keychain)
- Platform: macOS only. Throws on other platforms for `setSecret`.

**Local Gateway Token:**
- Auto-generated Bearer token securing the local HTTP gateway
- Stored in keychain as `local_gateway_token` (configurable via `config.gateway.tokenRef`)
- Generated via `crypto.randomBytes(32).toString("base64url")`
- Validated on every gateway request via `Authorization: Bearer {token}` or `x-mcpx-local-token` header
- Implementation: `cli/src/core/registry.ts` (`ensureGatewayToken`), `cli/src/gateway/server.ts` (`authHeaderIsValid`)

**Secret References (`secret://` protocol):**
- Config values starting with `secret://` are resolved from keychain at runtime
- Example: `"tokenRef": "secret://local_gateway_token"` or header values like `"Authorization": "secret://my_api_key"`
- Implementation: `cli/src/core/secrets.ts` (`resolveMaybeSecret`)
- Used for: Gateway token, upstream server auth headers, upstream server env vars

**Auth Probing:**
- The CLI can probe upstream HTTP servers to detect if auth is required
- Implementation: `cli/src/core/auth-probe.ts` (`probeHttpAuthRequirement`)
- Sends a `tools/list` JSON-RPC request and checks for 401/403 response

## AI Client Sync Adapters

The gateway syncs its managed MCP endpoints into multiple AI client configuration files.

**Supported Clients:**
| Client | Adapter | Config Path | HTTP Support |
|--------|---------|-------------|--------------|
| Claude Desktop/CLI | `cli/src/adapters/claude.ts` | `~/.claude.json` | Yes |
| Codex (OpenAI) | `cli/src/adapters/codex.ts` | Codex config location | Yes |
| Cursor | `cli/src/adapters/cursor.ts` | Cursor MCP config | Yes |
| Cline (VS Code ext) | `cli/src/adapters/cline.ts` | Cline settings | Yes |
| OpenCode | `cli/src/adapters/opencode.ts` | OpenCode config | Yes |
| Kiro | `cli/src/adapters/kiro.ts` | Kiro config | Yes |
| VS Code | `cli/src/adapters/vscode.ts` | VS Code settings | Yes |
| Qwen CLI | `cli/src/adapters/qwen.ts` | Qwen config | Yes |

**Adapter interface:** `cli/src/types.ts` (`ClientAdapter`)
- `detectConfigPath()` - Locate the client's config file
- `supportsHttp()` - Whether the client supports MCP over HTTP
- `syncGateway(config, options)` - Write managed entries to client config

**Compatibility Layer:** `cli/src/compat/` - Parses native CLI commands from other clients:
- `cli/src/compat/claude.ts` - `claude mcp add` syntax
- `cli/src/compat/codex.ts` - `codex mcp add` syntax
- `cli/src/compat/qwen.ts` - `qwen mcp add` syntax
- `cli/src/compat/vscode.ts` - `code --add-mcp` syntax
- `cli/src/compat/unsupported.ts` - Fallback for unrecognized clients

## Monitoring & Observability

**Error Tracking:**
- None. No external error tracking service.

**Logs:**
- Daemon: Writes to `~/.local/state/mcpx/logs/daemon.log` (append mode, file descriptor passed to child process)
- Gateway debug: When `MCPX_GATEWAY_DEBUG=1`, logs JSON-RPC method calls, auth status, and responses to stderr
- Desktop app: Standard Electron `console.log`/`console.error` to stdout/stderr
- CLI: Direct console output for user-facing messages

## CI/CD & Deployment

**Hosting:**
- npm registry (`@kwonye/mcpx`) for CLI package
- GitHub Releases for desktop app artifacts (DMG, ZIP)

**CI Pipeline:**
- GitHub Actions with two workflows:
  - `.github/workflows/cli-release.yml` - Triggered by pushes to `main` affecting `cli/**`. Builds, tests, publishes to npm with provenance, creates git tags.
  - `.github/workflows/desktop-release.yml` - Triggered by pushes to `main` affecting `app/**` or `cli/**`, or by tag pushes. Builds signed/notarized macOS universal binary.
- Build runner: `ubuntu-latest` for CLI, `macos-14` for desktop
- Node version: 20 (pinned in workflows)
- Release coordinator: `.github/scripts/release-coordinator.mjs` handles version computation and release body generation

**Code Signing (Desktop):**
- Apple Developer certificate (P12 base64) via `MACOS_CERTIFICATE_P12_BASE64` secret
- Notarization via `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets
- Graceful fallback to unsigned build when secrets are missing
- electron-builder with `--mac --universal` for fat binary (arm64 + x64)

**Auto-Update:**
- Desktop app checks for updates every 6 hours via `electron-updater`
- Implementation: `app/src/main/update-manager.ts`
- Publish target: GitHub Releases (configured in `app/package.json` under `build.publish`)
- Update artifacts: `latest*.yml` manifest files alongside DMG/ZIP

## Environment Configuration

**Required env vars for development:**
- None strictly required (defaults to `~/.config/mcpx/` paths)

**Required env vars for CI:**
- npm publish: `NPM_TOKEN` (implicit via npm CI)
- Desktop signing: `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- GitHub: `GITHUB_TOKEN` (auto-provided)

**Secrets location:**
- CI secrets: GitHub Actions repository secrets
- Runtime secrets: macOS Keychain (service: `mcpx`)
- Secret name index: `~/.local/share/mcpx/secret-names.json`

## Webhooks & Callbacks

**Incoming:**
- Local HTTP gateway at `http://127.0.0.1:{port}/mcp` - Receives JSON-RPC requests from AI clients
- OAuth well-known endpoints at `/.well-known/oauth-*` - Proxied from upstream servers

**Outgoing:**
- None (no webhook subscriptions)

## Network Architecture

**Gateway Server:**
- Implementation: `cli/src/gateway/server.ts` (`createGatewayServer`)
- Protocol: HTTP/1.1 via Node.js `http.createServer`
- Binds to: `127.0.0.1` only (localhost)
- Default port: `37373` (auto-increments if occupied, up to +20)
- Endpoint: `POST /mcp` for JSON-RPC, `GET /mcp` for health check
- Auth: Bearer token or `x-mcpx-local-token` header
- Supports: JSON and SSE response formats, batch JSON-RPC requests
- Session: Generates `mcp-session-id` UUID on `initialize` requests
- Body limit: 10MB max request body
- Upstream timeout: 60s default (configurable via `MCPX_UPSTREAM_TIMEOUT_MS`)
- Connect timeout: 10s for stdio upstream connections

---

*Integration audit: 2026-03-09*
