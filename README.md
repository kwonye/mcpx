# mcpx

`mcpx` is a local MCP gateway that lets you install upstream MCP servers once, authorize them once, and expose them to multiple AI clients through managed gateway entries.

## What it does

- Stores upstream servers in a central config (`~/.config/mcpx/config.json`)
- Stores upstream auth in one consolidated secure store so each MCP auth flow is done once and reused across all synced clients
- Runs a local MCP gateway daemon (`http://127.0.0.1:<port>/mcp`)
- Syncs managed gateway entries into supported clients (one per upstream):
  - Claude
  - Codex
  - Cursor
  - Cline
  - OpenCode
  - Kiro
  - VS Code
- Gives each upstream a top-level client entry (`/vercel`, `/next-devtools`, etc.) while routing through one local daemon.
- Uses local gateway-token auth for client -> gateway (`x-mcpx-local-token`)
- Supports keychain-backed secret references for upstream headers
- Passes upstream OAuth challenges (`401/403` + `WWW-Authenticate`) through to compatible clients
- Proxies OAuth well-known metadata endpoints in single-upstream mode (`/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`)

## Install / run

Global install from npm:

```bash
npm install -g @kwonye/mcpx@latest
```

Build/run from source:

```bash
npm install
npm run build
node dist/cli.js --help
```

For local development:

```bash
npm run dev -- --help
```

## Core commands

```bash
mcpx add circleback https://app.circleback.ai/api/mcp
mcpx add next-devtools npx next-devtools-mcp@latest
mcpx add next-devtools --transport stdio npx next-devtools-mcp@latest
mcpx remove circleback
mcpx list
mcpx sync
mcpx sync claude
mcpx sync codex
mcpx status
mcpx doctor
```

`add` and `remove` update the central `mcpx` registry and automatically sync managed entries across supported clients.
Use `mcpx sync ...` when you want to manually re-sync or target specific clients.

Daemon lifecycle:

```bash
mcpx daemon start
mcpx daemon status
mcpx daemon logs
mcpx daemon stop
```

Secrets:

```bash
mcpx secret set circleback_token --value "..."
mcpx secret ls
mcpx secret rm circleback_token
mcpx auth set vercel --header Authorization --value "Bearer ..."
mcpx auth set next-devtools --env NEXT_DEVTOOLS_TOKEN --value "..."
mcpx auth show
mcpx auth rm vercel --header Authorization --delete-secret
mcpx auth rotate-local-token
```

Compatibility namespace:

```bash
mcpx mcp add circleback https://app.circleback.ai/api/mcp
mcpx mcp add next-devtools npx next-devtools-mcp@latest
```

## Config and state paths

- Config: `~/.config/mcpx/config.json`
- Managed index: `~/.local/share/mcpx/managed-index.json`
- Secret name index: `~/.local/share/mcpx/secret-names.json`
- Daemon PID: `~/.local/state/mcpx/runtime/daemon.pid`
- Daemon logs: `~/.local/state/mcpx/logs/daemon.log`

Override roots with env vars:

- `MCPX_CONFIG_HOME`
- `MCPX_DATA_HOME`
- `MCPX_STATE_HOME`

## Test

```bash
npm test
```

## Notes

- v1 is HTTP-only for client connectivity.
- Upstreams can be HTTP or stdio command-based.
- No stdio fallback is implemented for client connectivity.
- macOS keychain is the default secure secret backend.
- CI/headless secret override is supported via `MCPX_SECRET_<name>` env vars.
