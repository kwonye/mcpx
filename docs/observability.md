# mcpx observability runbook

This runbook is for maintainers operating the privacy-respecting PostHog and
Sentry projects. mcpx has no central service, so the local daemon logs and
existing desktop server-failure notifications remain the first-line support
tools.

## Provider configuration

Create one EU-region PostHog project and one EU-region Sentry project named
`mcpx`. Keep these controls enabled:

- PostHog: IP capture off, person profiles off, autocapture off, session replay
  off, feature flags off, GeoIP off, 12-month retention.
- Sentry: enhanced privacy on, IP scrubbing on, 30-day (or shortest available)
  retention, no user identity, no profiling or screenshots.

PostHog dashboards should cover active installations, platform/version
adoption, the activation funnel, feature usage, and operation/gateway
reliability. Configure email alerts for operation failure rate above 10% over
one hour with at least 20 events, and for three update failures in 24 hours.

Configure Sentry email notifications to the verified maintainer address for
new issues and regressions, and when an issue reaches five events in ten
minutes. Do not add a Sentry user or the PostHog installation ID to reports.

## Release configuration

GitHub Actions **Variables** (public build inputs) are:

- `MCPX_POSTHOG_PROJECT_TOKEN`
- `MCPX_POSTHOG_HOST`
- `SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Store only `SENTRY_AUTH_TOKEN` as a GitHub Actions secret, scoped to the
`org:ci` organization permission. The token is used only by the post-build
source-map upload job.

Production CLI and Electron builds generate hidden/private source maps. The
release workflow uploads them to the Sentry release tagged with the coordinated
`mcpx@<version>` after all platform builds pass, then removes them before npm
and desktop packaging. Public provider values are compiled into production
bundles; the install-time privacy overrides remain runtime-controlled. Source
maps are never published as release assets.

## Triage

1. Check the Sentry issue and release tag. Read only sanitized frames and the
   allowlisted lifecycle/operation breadcrumbs.
2. Check PostHog reliability dashboards for the affected release, runtime, OS
   family, and operation enum. Use bucketed counts to distinguish a broad
   outage from a single installation.
3. Ask the user for local daemon logs or the existing desktop notification
   details when an upstream name, URL, or request-specific context is needed;
   those values are intentionally not remote telemetry.
4. Treat provider outages as non-blocking. Verify the app/CLI still starts and
   exits normally with the providers unreachable.

## Release verification checklist

- Build with the public PostHog host/token and Sentry DSN variables.
- Confirm a fresh install shows the disclosure before any network request.
- Confirm PostHog receives only the documented personless event fields and no
  IP/GeoIP/person profile.
- Disable usage analytics and verify queued events are cleared and no further
  provider requests occur; disable error reporting and verify Sentry's client
  is disabled immediately while Electron's raw direct uploader remains off.
- Trigger a controlled JavaScript exception and verify readable source-mapped
  Sentry frames.
- Trigger a controlled native crash in a disposable build and verify a Sentry
  minidump, remembering the residual memory-fragment privacy warning.
- Verify the configured PostHog and Sentry alert emails.

GitHub Actions sends build, source-map-upload, and release failures to the
repository maintainers through the normal workflow notifications. A failed
source-map upload must fail the release before packaging/publishing rather than
shipping an untraceable build.
