# Gateway architecture

mcpx owns a canonical catalog of upstream MCP servers, skills, and plugins.
Harness configuration files are managed projections of that catalog. Native
plugin components are projected only where an adapter supports them; MCP servers
run behind the shared gateway, and shared skills retain their supporting files.

## Entry points and writes

The desktop renderer uses a typed Electron preload bridge. In production,
management requests go to the local authenticated control socket. The control
service queues mutations, records operations, and publishes a committed runtime
snapshot for gateway requests. CLI worker leases serialize command execution
with desktop and automatic-adoption work. The direct IPC implementations remain
available for isolated tests and use the same core synchronization transaction.

Application code calls `synchronizeClients` in `cli/src/core/sync.ts`. It reloads
the canonical config under the cross-process config lock, selects targets, runs
server, skill, and plugin projections under the managed-index lock, and persists
sync status before releasing the config lock. This prevents a sync snapshot from
overwriting a concurrent installation or credential change. Custom config paths
and injected secret stores are passed through every phase.

`syncAllClients` remains the synchronous projection engine for compatibility and
adapter tests. New application entry points should use `synchronizeClients`.
The lock order is config, managed index, then credential store. Do not acquire
these locks in reverse order or call the transaction from a config mutator.

## Selection and ownership

The shared target selector powers both sync previews and execution. Default sync
targets detected or explicitly enrolled installations. Explicit targets can
initialize an installation that is not detected. Unknown IDs fail validation;
an empty target list selects nothing. Observe-only mode always prevents writes.
Automatic mode additionally adopts supported, unambiguous native installations
through the control service's adoption planner and recoverable operation receipts.

Each adapter owns its paths, naming, supported components, and native document
format. Managed fingerprints protect local edits. Errors in one projection are
recorded per harness while other projections continue. Desktop harness cards
show persisted diagnostics, and control operations with partial sync failures
are marked failed even when their canonical installation was saved successfully.

## Authentication

Upstream API keys and OAuth credentials live in one shared store. The default
is an AES-256-GCM encrypted file whose key sits next to the ciphertext. An
opt-in OS keychain backend (macOS Keychain via `security`, Linux libsecret via
`secret-tool`) is available with `mcpx secret backend keychain`; switching
backends copies every secret and deletes the previous copy only after the new
copy verifies. Canonical server definitions contain `secret://` or `oauth://` references.
HTTP credentials bind to headers; stdio credentials bind to explicitly named
environment variables. The gateway resolves references and refreshes upstream
OAuth credentials for all harnesses using that canonical server.

Each harness receives a distinct, stable local gateway bearer token. Project
consumer tokens carry project scope. Upstream credentials are never copied into
native harness configurations. CLI and desktop use the same vault, so changing
harnesses does not require repeating the upstream authorization flow.

Reading an existing vault never creates an encryption key. If the vault cannot
be decrypted, credential writes and removals fail while preserving the original
files. Restore the matching key or vault backup before retrying; mcpx does not
silently reset authentication state.

## Verification

Run the CLI tests and build in `cli/`, then desktop type checking, tests, and build
in `app/`. `cli/test/sync-service.test.ts` covers target selection, concurrent
mutations, separate config/vault instances, credential isolation, and idempotency.
The installed-app flow in `app/e2e/adoption-installed.spec.ts` covers stdio auth,
two-harness sync, native adoption, MCP invocation, and undo. Set
`MCPX_INSTALLED_APP_PATH` to a packaged app executable to run it.

The release workflow uses Bun 1.4.0 and frozen dependency installs. Desktop jobs
run type checking and unit tests on each platform; Linux also runs the full
Electron suite under Xvfb, including the packaged-app flows. Release versions are
assigned before compilation, and the packed CLI is checked against the release
version.

For local `act` validation, select `build-cli` and `build-desktop-linux` with a
`workflow_dispatch` event, repository event metadata, and a local artifact
backend. This exercises metadata, build, test, packaging, and artifact upload
without running the publish job. `act` 0.2.89 requires a transport adapter that
URL-encodes its artifact signatures for `actions/upload-artifact@v6`; validation
steps remain unchanged. macOS/Windows runtime checks and platform signing
require their native CI runners.
