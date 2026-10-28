# Local gateway architecture

mcpx has a local MCP data plane and a separate management control plane. Both
are served by the local mcpx service, but they have different clients,
protocols, and credentials.

## MCP traffic and local management

Coding harnesses connect to the MCP gateway at
`http://127.0.0.1:<port>/mcp`, using a local bearer token or
`x-mcpx-local-token`. The gateway routes MCP requests to configured HTTP and
stdio upstreams and applies the harness consumer's access scope.

The app and management CLI use a local control API. On macOS and Linux that
is a Unix-domain socket, `runtime/control.sock` under the state directory, or
a shorter socket in the temp directory when that path is 96 bytes or longer.
On Windows, Bun cannot listen on a named pipe, so the service listens on
`127.0.0.1` at a stable port in the dynamic range, derived from the user and
the config path. A separate control key is stored with the runtime files and
is required for commands and event subscriptions. The API carries management
operations and status; MCP protocol traffic does not use this interface. The
desktop renderer calls through Electron IPC to the main process, which
connects to the same local service. The desktop app starts the bundled CLI
(`resources/cli/dist/cli.js` in a package, or `cli/dist/cli.js` found by
walking up from the app directory in development) and passes that path as
`MCPX_CLI_ENTRY` so the gateway process can find the same runtime.

Management writes pass through one serialized queue. Mutating CLI commands
that still run their existing command handlers acquire a process lease first;
the control service holds the writer slot until that process reports success or
failure, or exits. This prevents those commands from racing app or management
API writes.

## Adoption and recovery

Discovery is read-only. `mcpx adopt --dry-run` produces a plan with item
fingerprints and classifies each native MCP server, skill, or supported package
as import, reuse, conflict, or unsupported. Before applying a plan, mcpx checks
that the central config and discovered native entries have not changed, then
rescans the candidates. Only supported, selected items are applied. Newly
adopted MCP upstreams are staged and verified before any configuration is
committed.

For a native MCP entry, mcpx prepares a gateway-backed replacement and carries
over selected native settings. It writes managed package/skill data, central
config, and the ownership index before switching the native harness config to
the managed entry. The operation's complete write receipt is encrypted before
the first file change. Each write is checked against its planned before-state
and verified after writing. If the process stops mid-operation, the next
control service startup marks it as recovery-required.

`mcpx activity` lists operation IDs and states. `mcpx undo <id>` uses the
encrypted receipt to reverse the operation. Undo preserves unrelated later
edits where it can identify the changed values; if an affected value has
conflicting later edits, it stops and reports the conflict rather than
overwriting them. A completed adoption updates harness configuration on disk;
reload that harness configuration or restart its session to use the managed
installation.

## Harness modes and codecs

Each global or project harness installation has a synchronization mode:

- `observe` discovers the installation but skips managed sync and automatic
  adoption. Project installations default to this mode.
- `selected` participates in explicit sync and adoption actions. Global
  installations default to this mode.
- `automatic` also scans periodically and adopts supported, unambiguous
  imports or reuses. Conflicts and unsupported entries remain for review.

Automatic adoption waits while an interrupted operation requires recovery.

Harnesses are registered in `cli/src/adapters/index.ts` with an adapter factory
and a descriptor for paths and declared capabilities. The shared
`JsonHarnessAdapter` handles standard JSON MCP configuration; OpenCode uses its
alternate JSON key, and clients with different formats provide a custom
adapter/codec. The Pi adapter supports global and project MCP config, skill
directories, and local directory package declarations. Native package adoption
currently supports registered Claude plugin install directories and Pi local
directory packages. Pi `npm:`, `git:`, HTTP(S), and SSH package declarations
remain untouched and are reported for review until resolved to a local source.
Native package components remain harness-specific; the registry and codecs do
not make arbitrary plugin behavior portable across harnesses.

Codex projections use `~/.agents/skills` and project `.agents/skills`, while
the older `~/.codex/skills` location remains available for discovery. VS Code
project projections use `.github/skills`. These locations follow the
[Codex skill documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
and [VS Code skill documentation](https://code.visualstudio.com/docs/agent-customization/agent-skills).

Adopted Claude plugin and Pi package sources are stored as local, fingerprinted
revisions under mcpx's package data. An update creates a new revision instead
of editing the prior snapshot in place. Pinning a package prevents adoption of
a changed source until it is unpinned. Use `mcpx package update <id>` to adopt a
changed native revision. A package source root may rely on sibling `node_modules`
dependencies outside the copied directory. Such packages need a managed
installation that preserves their dependency layout before adoption.

Legacy skill ownership manifests are migrated only when the existing
projection matches its source. Ambiguous older projections are retained for
review and are not blindly overwritten or pruned.

Unknown or ambiguous MCP transports, unsafe variable interpolation, name
conflicts, unreadable configurations, and unsupported formats are skipped or
flagged for review; mcpx does not guess at their meaning. Native package
snapshots are limited to 64 MiB.

## CLI entry points

The desktop Control Center and `mcpx tui` expose the same harness, adoption,
activity, and recovery operations. The corresponding CLI commands are:

```sh
mcpx tui
mcpx harnesses --json
mcpx adopt --dry-run
mcpx adopt --yes
mcpx harness-mode pi automatic
mcpx activity
mcpx package list
mcpx package pin <id>
mcpx package update <id>
mcpx undo <operation-id>
```

`mcpx adopt --yes` applies supported imports and reuses from the discovered
plan. Use `mcpx adopt --dry-run --harness <id>` to limit a preview to one
installation. See the [README CLI guide](../README.md#advanced-cli-usage) for
general installation and gateway commands.
