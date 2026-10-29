# mcpx

<p align="center">
  <img src="design/icon-preview-512.png" width="128" height="128" alt="mcpx logo">
</p>

<p align="center">
  <b>mcpx</b> is a local MCP gateway. Install upstream MCP servers once, authorize them once, and expose them to multiple AI clients — all managed from a native desktop app (macOS + Linux + Windows) or CLI.
</p>

![Dashboard](docs/images/mcpx-dashboard.png)

## Platforms

- **macOS** — Desktop app (menubar tray) + CLI
- **Linux** — Desktop app (system tray) + CLI
- **Windows** — Desktop app (system tray) + CLI
- **CLI only**: Any platform with Node.js/Bun

## Desktop App

The mcpx desktop app is the easiest way to manage your MCP servers. It runs in your system tray with a full dashboard for server discovery, configuration, and monitoring.

- **Menubar tray** — Gateway status, quick server list, and one-click dashboard access from the menu bar
- **Dashboard** — Start/stop the gateway daemon, view connected servers, and add new ones with a paste-and-go command input
- **Browse Registry** — Discover and one-click install servers from the official MCP Registry
- **Projects** — Organize servers into project-specific groups
- **Skills** — Create and manage shared MCP skill definitions
- **Settings** — Configure auto-start, launch-at-login, and auto-updates
- **Privacy & diagnostics** — Independently control anonymous usage analytics
  and crash diagnostics, reset the random installation ID, and review the
  complete [privacy policy](PRIVACY.md)

### Download

Download the latest release from [GitHub Releases](https://github.com/kwonye/mcpx/releases).

### Install from source

Prerequisites: [Bun](https://bun.sh) >= 1.4.0

**macOS:**
```bash
git clone https://github.com/kwonye/mcpx.git
cd mcpx/cli
bun install
cd ../app
bun install
bun run desktop-install
```

This builds and installs the app to `/Applications/mcpx.app`.

For development with DevTools:
```bash
bun run desktop-install:dev
```

**Linux:**
```bash
git clone https://github.com/kwonye/mcpx.git
cd mcpx/app
bun install
bun run build
bunx electron-builder build --linux
```

This produces an AppImage and `.deb` in `app/dist/`.

**Windows:**
```bash
git clone https://github.com/kwonye/mcpx.git
cd mcpx/app
bun install
bun run build
bunx electron-builder build --win
```

This produces an NSIS installer and portable `.exe` in `app/dist/`.

### Quick Tour

**Menubar tray & popover** — The tray icon shows gateway status (green = running, red = stopped). Click it to open a quick-status popover:

![Popover](docs/images/mcpx-popover.png)

- **Start / Stop** the gateway daemon
- See active server count at a glance
- **Add Your First Server** — Paste any `mcpx add` command directly into the popover
- **Open Dashboard** — Jump to the full management window

**My Servers tab** — The main view for managing your MCP servers:

![Servers](docs/images/mcpx-servers.png)

- See all configured upstream servers and their connection status
- Start/stop the gateway daemon
- Add servers by pasting an `mcpx add` command (e.g. `mcpx add vercel https://mcp.vercel.com/mcp`)

**Browse Registry tab** — Discover and install MCP servers from the official registry:

![Browse](docs/images/mcpx-browse.png)

- Browse curated MCP servers
- One-click install

**Projects tab** — Organize servers into project groups:

![Projects](docs/images/mcpx-projects.png)

**Skills tab** — Manage shared skill definitions:

![Skills](docs/images/mcpx-skills.png)

Skills are stored as complete Agent Skill directories (`SKILL.md`, optional
`scripts/`, `references/`, and `assets/`). Clients receive complete directory projections, linked to the managed source when
supported. Installed skills are immutable until copied with `mcpx skill
customize`.

**Settings tab** — App configuration:

![Settings](docs/images/mcpx-settings.png)

---

## CLI

The `mcpx` CLI is also available as a standalone npm package for terminal workflows and CI.

### Privacy and diagnostics

mcpx keeps analytics dormant until its first-run disclosure is acknowledged.
Usage analytics and crash diagnostics are independently controllable, and both
are anonymous by design. Review or change them with:

```bash
mcpx telemetry status
mcpx telemetry enable usage|errors|all
mcpx telemetry disable usage|errors|all
mcpx telemetry reset-id
```

See [PRIVACY.md](PRIVACY.md) for the exact event catalog, prohibited data, and
native minidump warning. Maintainers can follow the [observability runbook](docs/observability.md)
to configure provider projects, alerts, and release source maps.

### Install

```bash
npm install -g @kwonye/mcpx@latest
# or
bun add -g @kwonye/mcpx@latest
```

### Quick Start

#### Add servers with CLI (recommended)

```bash
mcpx add vercel https://mcp.vercel.com/mcp
mcpx add next-devtools npx next-devtools-mcp@latest
```

`mcpx add` and `mcpx remove` auto-sync by default. Run `mcpx sync` when you want a manual re-sync or to target specific clients.

#### Client-native compatibility shims

```bash
# Claude Code
mcpx claude mcp add vercel https://mcp.vercel.com/mcp

# Codex
mcpx codex mcp add next-devtools --env FOO=bar -- npx next-devtools-mcp@latest

# VS Code
mcpx code --add-mcp '{"name":"vercel","url":"https://mcp.vercel.com/mcp"}'
```

#### Add servers manually in JSON config

Edit `~/.config/mcpx/config.json` and add entries under `servers`:

```json
{
  "servers": {
    "vercel": {
      "transport": "http",
      "url": "https://mcp.vercel.com/mcp",
      "headers": {
        "Authorization": "secret://vercel_auth_header"
      }
    },
    "next-devtools": {
      "transport": "stdio",
      "command": "npx",
      "args": ["next-devtools-mcp@latest"],
      "env": { "FOO": "bar" },
      "cwd": "/path/to/project"
    }
  }
}
```

After manual edits, run `mcpx sync` to propagate changes.

---

## What it does

- Stores upstream servers in a central config (`~/.config/mcpx/config.json`)
- Stores upstream auth in one consolidated secure store (AES-256-GCM encrypted file) so each MCP auth flow is done once and reused across all synced clients
- Runs a local MCP gateway daemon (`http://127.0.0.1:<port>/mcp`)
- Syncs managed gateway entries into supported clients:
  - Claude / Claude Code
  - Codex
  - Cursor
  - Cline
  - OpenCode
  - Kiro
  - VS Code / VS Code Insiders
  - Qwen CLI
  - OpenClaw
  - Hermes
- Gives each upstream a top-level client entry (`/vercel`, `/next-devtools`, etc.) while routing through one local daemon
- Uses local gateway-token auth for client → gateway (`x-mcpx-local-token`)
- Supports encrypted-file backed secret references for upstream headers (AES-256-GCM, no Keychain)
- Passes upstream OAuth challenges through to compatible clients
- Proxies OAuth well-known metadata endpoints in single-upstream mode

### MCP protocol support

mcpx supports MCP v2 only, pinned to protocol revision `2026-07-28`. The local
`/mcp` endpoint accepts modern MCP v2 envelopes and rejects legacy initialize,
session, batch, and legacy HTTP+SSE transport traffic. Client configuration adapters remain available
for projecting the v2 gateway into supported client config formats; they do not
add legacy protocol support.

---

## Advanced CLI Usage

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

# OAuth
mcpx auth login vercel     # browser sign-in for an HTTP upstream that supports OAuth
mcpx auth status           # sign-in state, token expiry, and secret-binding status (offline)
mcpx auth logout vercel    # clear stored OAuth credentials and the Authorization binding
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

### Local gateway control

The desktop Control Center and management CLI share the local control service.
See the [gateway architecture guide](docs/local-gateway.md) for its control
socket, adoption and recovery behavior.

```bash
mcpx tui
mcpx harnesses --json
mcpx adopt --dry-run
mcpx adopt --yes
mcpx harness-mode pi automatic
mcpx activity
mcpx package list
mcpx undo <operation-id>
```

### Open AI development standards

mcpx exclusively uses [Agent Skills](https://agentskills.io/specification),
[MCP revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28),
[AGENTS.md](https://agents.md/), and the official
[MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/) and
[Skills over MCP](https://modelcontextprotocol.io/extensions/skills/overview) extensions.
Claude, Codex, Cursor, and custom marketplace catalogs distribute plugins containing
standard Agent Skills and MCP servers. Hooks, slash commands, subagent definitions,
and native package loaders remain unsupported; plugin inspection identifies those components.

```bash
mcpx skill install ./review
mcpx skill install owner/skills --skill review
mcpx project instructions ./cli/src --root .
```

Skills must contain valid YAML frontmatter with a name matching the skill directory.
All supporting files are preserved. AGENTS.md files are read from the project root
to the target directory; the nearest file takes precedence where instructions conflict.
See [standards and migration](docs/standards.md) for compatibility details.

### Plugin marketplaces and management

The Library includes Discover, Installed, Marketplaces, and Shared Skills views.
Claude official (`anthropics/claude-plugins-official`), Codex official (`openai/plugins`),
and Cursor official (`cursor/plugins`) are configured by default. Add custom catalogs
from a local directory or JSON file, Git repository, GitHub shorthand, or hosted JSON URL.

```bash
mcpx plugin marketplace list
mcpx plugin marketplace add team/plugins
mcpx plugin marketplace add ./team-catalog --manifest catalogs/team.json
mcpx plugin browse --marketplace team-tools
mcpx plugin details reviewer@team-tools
mcpx plugin install reviewer@team-tools --yes
mcpx plugin disable reviewer
mcpx plugin enable reviewer
mcpx plugin pin reviewer
mcpx plugin unpin reviewer
mcpx plugin marketplace update team-tools
mcpx plugin rollback reviewer
mcpx plugin uninstall reviewer --keep-data
mcpx plugin marketplace remove team-tools --yes
```

Inspect a plugin's supported and unsupported components before installation. Updates
can be requested individually or by refreshing its marketplace. Pinning holds the
installed revision; rollback restores the previous cached revision. Automatic updates
are opt-in for new marketplaces. Custom marketplace removal uninstalls its plugins
while retaining plugin data. Default marketplaces cannot be replaced or removed.

### Portable environments

Export a Git-friendly folder containing a manifest, lockfile, and package
content. Credentials are represented as recipient inputs or secret references;
they are never copied into the export by default.

```bash
mcpx share export ./shared-environment
mcpx share import ./shared-environment --dry-run --locked
mcpx share import ./shared-environment --locked --input server.docs.header.X-Team=team-a
```
```

### Config/data/state path overrides

- `MCPX_CONFIG_HOME`
- `MCPX_DATA_HOME`
- `MCPX_STATE_HOME`

### Troubleshooting

```bash
mcpx doctor
mcpx status
mcpx daemon logs
mcpx sync --json
```

`mcpx status` opens an interactive MCP inventory menu in TTY sessions showing each configured upstream, which clients have it synced, and actions (configure auth, re-authenticate, clear auth, reconnect, disable).

---

## Build and test from source

### CLI

```bash
cd cli
bun install
bun run build
bun test
```

### Desktop app

```bash
cd app
bun install
bun run dev      # Start Electron dev server
bun run build     # Build for production
bun run test      # Run unit tests
bun run e2e       # Run Playwright E2E tests
```

---

## Architecture

This is a monorepo containing:

- **`cli/`** — The `mcpx` CLI and core library (`@kwonye/mcpx`)
- **`app/`** — The desktop app (Electron + React) for macOS, Linux, and Windows

The desktop app imports the CLI's core logic directly via a `@mcpx/core` TypeScript alias, so both packages share identical configuration parsing, sync logic, and secret management.

The target architecture consolidates MCP traffic and standard Agent Skills through one local service:

```mermaid
flowchart TB
    subgraph Harnesses["Coding harnesses"]
        Claude["Claude Code"]
        Codex["Codex"]
        Others["Other harnesses"]
    end

    Claude & Codex & Others --> HTTP["MCP over HTTP"]
    Claude & Codex & Others --> Stdio["MCP over stdio"]
    Claude & Codex & Others -.-> Native["Native configuration,<br/>Agent Skills"]

    HTTP --> Gateway
    Stdio --> Proxy
    Native -.-> Adapters

    subgraph MCPX["mcpx · Local service"]
        Proxy["Stdio proxy"] --> Gateway["Authenticated MCP gateway"]

        Gateway --> Router["Routing and access policy"]
        Router --> Runtime["Upstream runtime"]
        Runtime --> Secrets["Encrypted credentials"]

        Adapters["Harness adapters"] --> Sync["Sync and ownership engine"]
        Sync --> Catalog["MCP · Agent Skills catalog"]
        Sync --> Recovery["Operation journal and recovery"]

        Control["Management API"] --> Catalog
        Control --> Sync
        Control --> Lifecycle["Daemon lifecycle"]
    end

    Runtime --> Local["Local MCP processes"]
    Runtime --> Remote["Remote MCP servers"]

    GUI["Desktop GUI"] --> Control
    TUI["CLI / TUI"] --> Control
```

Claude Desktop uses the stdio proxy to reach the local mcpx gateway. Its [remote HTTP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) connect from Anthropic's cloud and require a publicly reachable server; they cannot connect directly to mcpx on localhost.

## Notes

- Client connectivity is HTTP-first; upstreams can be HTTP or stdio
- Secrets are stored in an encrypted file (`secrets.json` + `secrets.key` in the data directory) using AES-256-GCM via Node's built-in `crypto`. No native dependencies, no Keychain prompts.
- `MCPX_SECRET_<name>` env var overrides work on all platforms for CI/headless
