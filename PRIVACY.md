# mcpx privacy and diagnostics

mcpx is a local MCP gateway. Optional diagnostics are designed to answer two
questions: which capabilities are being used, and where the software is
failing. They are off until the first-run notice is acknowledged. Usage
analytics and error reporting are separate controls.

## Providers and retention

- Product analytics are sent to one EU-region PostHog Cloud project. The
  project is configured with IP capture, person profiles, autocapture, session
  replay, feature flags, and GeoIP disabled. Analytics retention is 12 months.
- Error and crash reports are sent to one EU-region Sentry Cloud `mcpx`
  project. Enhanced privacy and IP scrubbing are enabled. Error and native
  minidump retention is 30 days, or the shortest available plan setting.
- No Sentry user identity or PostHog person profile is created. A random,
  resettable installation UUID is used only for personless analytics events.

## Events

Every analytics event is validated against this closed catalog before it is
queued. Events include the runtime (`desktop`, `cli`, or `daemon`), release,
OS family, and CPU architecture where applicable.

| Event | Data sent |
| --- | --- |
| `runtime_started` | Runtime, coordinated version, OS family, architecture, and allowlisted launch mode |
| `activation_milestone` | `first_server_added`, `first_sync_succeeded`, or `first_gateway_request_succeeded` |
| `operation_completed` | Closed operation enum, success/failure, normalized error code, and duration bucket |
| `gateway_health_summary` | 24-hour bucketed calls, successes, errors, MCP method family, configured server/client/plugin count buckets, and uptime bucket |
| `desktop_tab_viewed` | `servers`, `projects`, `plugins`, or `settings` |
| `update_completed` | Check/install/rollback outcome and sanitized source/target versions |

The operation enum covers server changes, client sync, authentication, daemon
lifecycle, updates, projects, skills, plugins, and marketplaces. Names and
arguments are never included.

The closed operation values are `server_add`, `server_update`,
`server_remove`, `server_toggle`, `client_sync`, `auth_login`, `auth_logout`,
`daemon_start`, `daemon_stop`, `daemon_restart`, `update_check`,
`update_install`, `update_rollback`, `project_init`, `project_remove`,
`skill_add`, `skill_remove`, `plugin_install`, `plugin_update`,
`plugin_uninstall`, `plugin_toggle`, `marketplace_add`,
`marketplace_refresh`, and `marketplace_remove`. Normalized error codes are
limited to `auth_required`, `auth_expired`, `auth_cancelled`,
`daemon_restart_failed`, `invalid_pid`, `pid_not_found`, `rollback_failed`,
`secret_missing`, `sync_error`, `timeout`, `unreachable`, `upstream_error`,
`unexpected_error`, `update_check_failed`, `update_check_timeout`,
`update_failed`, and `validation_error`.

## Error reports

Unexpected startup failures, uncaught exceptions/rejections, daemon
termination, renderer crashes, and native Electron crashes may create Sentry
issues. Reports contain sanitized stack frames, exception class, release,
runtime, OS family, and architecture. Absolute paths are reduced to source
file names. Expected validation, authentication, and classified upstream
failures remain aggregate analytics.

Error reports do not include raw messages, request data, console or network
breadcrumbs, local variables, screenshots, profiling, session replay, prompts,
results, URLs, headers, environment values, secrets, usernames, hostnames,
project/file paths, locale, or IP address. Native minidumps are uploaded
automatically when error reporting is enabled; minidumps can contain fragments
of process memory and cannot be guaranteed anonymous.

## What is never collected

mcpx does not send server, tool, plugin, skill, or marketplace names; command
arguments; prompts or results; URLs or request bodies; headers; environment
values; secrets; usernames; hostnames; project or file paths; locale; IP
address; or raw error text.

## Controls

The desktop app shows a blocking disclosure on first run. The Settings →
Privacy & diagnostics group has independent toggles for anonymous usage
analytics and anonymous crash diagnostics, plus a reset-ID action.

Interactive CLI users see the disclosure once. Controls are also available
without a prompt:

```text
mcpx telemetry status
mcpx telemetry enable usage|errors|all
mcpx telemetry disable usage|errors|all
mcpx telemetry reset-id
```

`DO_NOT_TRACK=1` and `MCPX_TELEMETRY_DISABLED=1` always disable both providers.
Development builds, tests, and CI are disabled unless
`MCPX_TELEMETRY_ALLOW_TESTING=1` is explicitly set for a local fake collector.
Disabling usage analytics immediately stops and clears queued events and
deletes the installation UUID. Resetting the ID creates a new random UUID and
restarts activation milestones.

Telemetry failures are best-effort: they never change command exit status,
prevent startup, or delay CLI exit beyond a short bounded flush.
