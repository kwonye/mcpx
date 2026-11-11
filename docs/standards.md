# AI development standards

mcpx uses the following public standards for agent-facing content and traffic:

| Surface | Standard | mcpx behavior |
| --- | --- | --- |
| Reusable workflows | [Agent Skills](https://agentskills.io/specification) | Complete directories containing `SKILL.md`, YAML frontmatter, and supporting files |
| Tool and resource transport | [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Official SDK 2.0, pinned revision, HTTP POST and stdio; no legacy handshake or sessions |
| Remote skill discovery | [Skills over MCP](https://modelcontextprotocol.io/extensions/skills/overview) | `skills/list`, `skills/get`, `resources/read`, complete SHA-256 manifests, and project-scoped visibility |
| Project guidance | [AGENTS.md](https://agents.md/) | Plain Markdown, directory scopes, root-to-nearest inspection through `mcpx project instructions` |
| Interactive tool interfaces | [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/) | Gateway and stdio forwarding of extension capabilities, tool UI metadata, HTML resources, CSP metadata, and tool callbacks |

## Agent Skills

A skill must have a lowercase hyphenated name of 1–64 characters matching its
directory name and a nonblank description of at most 1024 characters. Optional
`license`, `compatibility`, `metadata`, and `allowed-tools` fields follow the
Agent Skills specification. Unknown frontmatter fields are preserved. YAML field
order, quoted strings, multiline descriptions, and CRLF are accepted.

`mcpx skill install <source> --skill <name>` installs a local directory or a skill
from a Git repository. The desktop Library provides the same source installer.
Customization copies supporting files and updates the frontmatter name when renamed.
Skills are projected as directories, including in clients that previously received
flat Markdown files. No vendor instruction or permission format is generated.
Hosts remain responsible for skill activation and execution approval.

## AGENTS.md

`mcpx project instructions <target> --root <project>` reads applicable AGENTS.md
files, ordered from the project root to the nearest directory. The nearest file
wins conflicting instructions; explicit user prompts take precedence. Files require
no frontmatter or schema. This command preserves each file's content and provenance.
Targets and instruction symlinks outside the supplied project root are rejected.
It does not translate CLAUDE.md, vendor rules, or subagent definitions.

## MCP Apps

Client registrations already use `/mcp?upstream=<name>`. Use these scoped endpoints
for MCP Apps: application code can call the upstream's original tool names without
colliding with another server's tools. The gateway advertises `io.modelcontextprotocol/ui`
and preserves `text/html;profile=mcp-app`, visibility, CSP, permissions, and other
UI metadata. It forwards the host's per-request extension capabilities, without
caching responses across hosts with different capabilities.

At the aggregate `/mcp` endpoint, tool names are namespaced and UI resource URIs
remain `ui://` while gaining an upstream route. Resource content URIs are rewritten
to match. Apps that hardcode original tool names must use the scoped endpoint;
aggregate namespacing cannot rewrite tool names inside arbitrary application code.

mcpx is a gateway, not an MCP Apps UI host. The connected host renders the sandboxed
iframe and implements the AppBridge APIs, consent, host callbacks, and CSP enforcement.
mcpx forwards server resources and tool traffic; it does not render upstream HTML
in the desktop dashboard or grant browser permissions.

## Plugin distribution and marketplaces

Claude, Codex, Cursor, and custom marketplace catalogs and plugin manifests are
supported as distribution metadata. The three official defaults are:

| Marketplace | Repository | Catalog |
| --- | --- | --- |
| Claude official | `anthropics/claude-plugins-official` | `.claude-plugin/marketplace.json` |
| Codex official | `openai/plugins` | `.agents/plugins/marketplace.json` |
| Cursor official | `cursor/plugins` | `.cursor-plugin/marketplace.json` |

Add catalogs from GitHub shorthand (including `owner/repo@ref`), Git URLs, local
directories or JSON files, or hosted JSON catalogs with Git-backed plugin sources.
The CLI accepts `--manifest` for a custom catalog path; the Library has an optional
manifest-path field. Referenced local plugin paths must stay inside the catalog
snapshot, including through symlinks. A catalog's unavailable or invalid entries
do not prevent other valid entries from appearing.

Only Agent Skills and MCP servers are installed. Vendor hooks, slash commands,
subagents, rules, connector declarations, and other nonportable components are
reported as unsupported. MCP Apps delivered by an installed MCP server retain
the gateway support described above. A catalog compatibility badge describes
supported package content, not a successful connection to an arbitrary upstream.
The upstream must implement the configured MCP protocol revision.

The Library and CLI provide install, uninstall, enable/disable, updates, pinning,
rollback, custom marketplace removal, and optional automatic updates. Plugin skills
use `<plugin-name>/<skill-name>/SKILL.md` so identically named skills can coexist
without changing their declared names. Supporting files and locally edited
projections are preserved. Installed MCP definitions use the normal gateway,
credential, and consumer-scope mechanisms.

New marketplaces default to manual updates. Refreshing a marketplace updates its
unpinned installed plugins; explicit individual updates also respect pinning.
Rollback restores the cached content and source fingerprint from the previous
revision. Default marketplace sources cannot be replaced by a custom catalog.
Removing a custom marketplace uninstalls its plugins while keeping their data.

Native Claude/Pi package adoption and flat skill projections remain removed.
Old configuration records and user files are retained. Plugin bundle environment
imports/exports remain unsupported; use marketplaces for plugin distribution and
the environment exporter for standard skills and independently registered MCP servers.

Client MCP configuration files, local ownership receipts, credential storage, and
mcpx's environment lockfile remain implementation details: none of the agent-facing
standards defines a universal configuration or credential file format. A client's
own Agent Skills or MCP Apps support determines whether it can consume that output.
