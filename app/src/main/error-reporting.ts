import { crashReporter } from "electron";
import * as core from "@mcpx/core";
import type { TelemetryRuntime } from "@mcpx/core";

type SentryMain = typeof import("@sentry/electron/main");

let sentry: SentryMain | null = null;
let initialized = false;

function keepElectronCrashUploadsLocal(): void {
  try {
    crashReporter.setUploadToServer(false);
  } catch {
    // Electron may not expose the switch in a test or embedded host.
  }
}

const EXPECTED_ERROR_TYPES = new Set([
  "ConfigLoadError",
  "CommanderError",
  "ZodError",
  "ValidationError",
  "SyntaxError",
  "SecretNotFoundError",
  "UpstreamError",
  "OAuthCancelledError",
  "OAuthLoginInProgressError"
]);
const EXPECTED_ERROR_CODES = new Set([
  "auth_required",
  "auth_expired",
  "auth_cancelled",
  "secret_missing",
  "sync_error",
  "timeout",
  "unreachable",
  "upstream_error",
  "validation_error"
]);
const ALLOWED_OPERATIONS = new Set([
  "server_add", "server_update", "server_remove", "server_toggle", "client_sync",
  "auth_login", "auth_logout", "daemon_start", "daemon_stop", "daemon_restart",
  "update_check", "update_install", "update_rollback", "project_init", "project_remove",
  "skill_add", "skill_remove", "plugin_install", "plugin_update", "plugin_uninstall",
  "plugin_toggle", "marketplace_add", "marketplace_refresh", "marketplace_remove", "startup"
]);
const ALLOWED_ERROR_CODES = new Set([
  "auth_required", "auth_expired", "auth_cancelled", "daemon_restart_failed", "invalid_pid",
  "pid_not_found", "rollback_failed", "secret_missing", "sync_error", "timeout", "unreachable",
  "upstream_error", "unexpected_error", "update_check_failed", "update_check_timeout", "update_failed",
  "validation_error"
]);

function isSafeVirtualFilename(filename: string): boolean {
  return filename.startsWith("webpack:///") || /^app:\/\/(?:\/out\/|\/cli\/|\/desktop-cli-(?:macos|windows|linux|other)\/)/.test(filename);
}

function normalizeFilename(filename: string | undefined): string | undefined {
  if (!filename) return filename;
  const normalized = filename.replaceAll("\\", "/");
  if (isSafeVirtualFilename(normalized)) return normalized;
  const sourceMarker = normalized.lastIndexOf("/src/");
  if (sourceMarker >= 0) return normalized.slice(sourceMarker + 1);
  const nodeModulesMarker = normalized.lastIndexOf("/node_modules/");
  if (nodeModulesMarker >= 0) return `node_modules/${normalized.slice(nodeModulesMarker + "/node_modules/".length)}`;
  return normalized.split("/").at(-1);
}

function sanitizeEvent(event: any): any | null {
  if (!core.getTelemetryStatus().errorsActive) return null;
  const firstType = event.exception?.values?.[0]?.type;
  const errorCode = event.tags?.["mcpx.error_code"];
  if ((firstType && EXPECTED_ERROR_TYPES.has(firstType)) || (typeof errorCode === "string" && EXPECTED_ERROR_CODES.has(errorCode))) return null;

  event.message = undefined;
  event.request = undefined;
  event.user = undefined;
  event.extra = undefined;
  event.contexts = {
    os: { name: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "other" },
    device: { arch: process.arch }
  };
  const operation = event.tags?.["mcpx.operation"];
  const code = event.tags?.["mcpx.error_code"];
  event.tags = {
    ...(typeof event.tags?.["mcpx.runtime"] === "string" ? { "mcpx.runtime": event.tags["mcpx.runtime"] } : {}),
    ...(typeof operation === "string" && ALLOWED_OPERATIONS.has(operation) ? { "mcpx.operation": operation } : {}),
    ...(typeof code === "string" && ALLOWED_ERROR_CODES.has(code) ? { "mcpx.error_code": code } : {})
  };
  event.transaction = undefined;
  event.server_name = undefined;
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((breadcrumb: any) => breadcrumb.category === "mcpx.lifecycle" || breadcrumb.category === "mcpx.operation")
    .map((breadcrumb: any) => ({
      category: breadcrumb.category,
      level: breadcrumb.level,
      message: breadcrumb.category === "mcpx.lifecycle" ? "lifecycle" : "operation"
    }));
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value: any) => ({
      type: value.type,
      value: value.type ? "redacted" : undefined,
      mechanism: value.mechanism ? { type: value.mechanism.type, handled: value.mechanism.handled } : undefined,
      stacktrace: value.stacktrace
        ? {
            frames: value.stacktrace.frames?.map((frame: any) => ({
              filename: normalizeFilename(frame.filename),
              function: typeof frame.function === "string" ? frame.function : undefined,
              module: normalizeFilename(typeof frame.module === "string" ? frame.module : undefined),
              lineno: frame.lineno,
              colno: frame.colno,
              in_app: frame.in_app
            }))
          }
        : undefined
    }));
  }
  return event;
}

export async function initializeDesktopErrorReporting(release: string, productName = "mcpx"): Promise<boolean> {
  const dsn = process.env.MCPX_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) {
    keepElectronCrashUploadsLocal();
    if (!initialized) {
      try {
        crashReporter.start({
          productName,
          uploadToServer: false
        });
        initialized = true;
      } catch {
        return false;
      }
    }
    return false;
  }

  const status = core.getTelemetryStatus();
  if (!status.errorsActive && !initialized) {
    keepElectronCrashUploadsLocal();
    return false;
  }
  if (initialized && sentry) {
    await refreshDesktopErrorReporting(release);
    return status.errorsActive;
  }
  const module = sentry ?? await import("@sentry/electron/main");
  sentry = module;
  try {
    module.init({
      dsn,
      release,
      environment: "production",
      enabled: status.errorsActive,
      sendDefaultPii: false,
      includeLocalVariables: false,
      attachScreenshot: false,
      enableRendererProfiling: false,
      maxBreadcrumbs: 10,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      integrations: (defaults) => defaults.map((integration) => (
        integration.name === "SentryMinidump"
          ? module.sentryMinidumpIntegration({ maxMinidumpsPerSession: 10 })
          : integration
      )),
      beforeSend: sanitizeEvent
    });
  } catch {
    sentry = null;
    return false;
  }
  // Sentry's privacy-aware minidump integration owns Crashpad and forwards
  // dumps through Sentry's filtered client. Keep Electron's raw direct
  // uploader disabled so it cannot bypass beforeSend sanitization.
  keepElectronCrashUploadsLocal();
  core.setTelemetryErrorReporter((error, context) => {
    if (!sentry || !core.getTelemetryStatus().errorsActive) return;
    sentry.withScope((scope) => {
      scope.setTag("mcpx.runtime", context.runtime);
      if (context.operation) scope.setTag("mcpx.operation", context.operation);
      if (context.code) scope.setTag("mcpx.error_code", context.code);
      sentry?.captureException(error);
    });
  });
  initialized = true;
  return status.errorsActive;
}

export async function refreshDesktopErrorReporting(release: string): Promise<void> {
  if (!sentry) {
    await initializeDesktopErrorReporting(release);
    return;
  }
  const status = core.getTelemetryStatus();
  const client = sentry.getClient();
  if (client) {
    (client.getOptions() as { enabled?: boolean }).enabled = status.errorsActive;
  }
  if (status.errorsActive) {
    core.setTelemetryErrorReporter((error, context) => {
      if (!sentry || !core.getTelemetryStatus().errorsActive) return;
      sentry.withScope((scope) => {
        scope.setTag("mcpx.runtime", context.runtime);
        if (context.operation) scope.setTag("mcpx.operation", context.operation);
        if (context.code) scope.setTag("mcpx.error_code", context.code);
        sentry?.captureException(error);
      });
    });
  } else {
    core.setTelemetryErrorReporter(null);
  }
  keepElectronCrashUploadsLocal();
}

export function captureDesktopError(error: unknown, operation?: string, code?: string): void {
  try {
    core.reportTelemetryError(error, { runtime: "desktop" as TelemetryRuntime, operation, code });
  } catch {
    // Diagnostics must never replace the user's startup error handling.
  }
}

export async function flushDesktopErrorReporting(timeoutMs = 250): Promise<void> {
  if (!sentry) return;
  await Promise.race([
    sentry.flush(timeoutMs),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]).catch(() => undefined);
}
