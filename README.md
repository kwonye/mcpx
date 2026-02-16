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

## Install

Prerequisite: Node.js `>=20`

```bash
npm install -g @kwonye/mcpx@latest
```

## Quick Start

### Path A: Add servers with CLI (recommended)

```bash
# HTTP upstream
mcpx add vercel --transport http https://example.com/mcp

# stdio upstream
mcpx add next-devtools --transport stdio npx next-devtools-mcp@latest
```

`mcpx add` and `mcpx remove` auto-sync by default. Run `mcpx sync` when you want a manual re-sync or to target specific clients.

### Path B: Add servers manually in JSON config

Edit `~/.config/mcpx/config.json` and add entries under `servers`:

```json
{
  "servers": {
    "vercel": {
      "transport": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "secret://vercel_auth_header"
      }
    },
    "next-devtools": {
      "transport": "stdio",
      "command": "npx",
      "args": ["next-devtools-mcp@latest"],
      "env": {
        "FOO": "bar"
      },
      "cwd": "/path/to/project"
    }
  }
}
```

After manual edits, you must run:

```bash
mcpx sync
```

Manual config changes do not update client configs until `mcpx sync` runs.

## Supported Clients

- Claude
- Codex
- Cursor
- Cline
- VS Code

## Claude Convention

`mcpx` follows Claude-style MCP server conventions by syncing per-upstream entries keyed by server name under `mcpServers` in Claude config. Each entry is an HTTP endpoint to the local gateway (`/mcp?upstream=<name>`) and includes the required local auth header.

## How it works

1. Define upstream servers in central `mcpx` config.
2. `mcpx` ensures local gateway auth and daemon state.
3. `mcpx sync` writes managed client entries that point to the local gateway.

## Advanced Usage

### Auth and secrets

```bash
mcpx secret set vercel_auth_header --value "Bearer <token>"
mcpx secret ls
mcpx secret rm vercel_auth_header

mcpx auth set vercel --header Authorization --value "Bearer <token>"
mcpx auth set next-devtools --env NEXT_DEVTOOLS_TOKEN --value "<token>"
mcpx auth show
mcpx auth rm vercel --header Authorization --delete-secret
mcpx auth rotate-local-token
```

### Daemon lifecycle

```bash
mcpx daemon start
mcpx daemon status
mcpx daemon logs
mcpx daemon stop
```

### Targeted sync

```bash
mcpx sync
mcpx sync claude
mcpx sync --client claude --client codex
```

### Config/data/state path overrides

- `MCPX_CONFIG_HOME`
- `MCPX_DATA_HOME`
- `MCPX_STATE_HOME`

## Troubleshooting

```bash
mcpx doctor
mcpx status
mcpx daemon logs
mcpx sync --json
```

`mcpx status` now opens an interactive MCP inventory menu in TTY sessions:
- Shows each configured upstream MCP
- Shows which client config files currently have that MCP synced
- Lets you open a specific MCP and run actions (configure auth, re-authenticate, clear auth, reconnect, disable)

## Build and test from source

```bash
npm install
npm run build
npm test
```

## Notes

- Client connectivity is HTTP-first.
- Upstreams can be HTTP or stdio.
- macOS keychain is the secure secret backend.
- In CI/headless environments, `MCPX_SECRET_<name>` env vars can override keychain lookups.
