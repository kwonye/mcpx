import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import path from "node:path";
import {
  getTelemetryStatus,
  setTelemetryErrorReporter,
  type TelemetryRuntime
} from "./telemetry.js";

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

let initialized = false;

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

function sanitizeEvent(event: ErrorEvent): ErrorEvent | null {
  if (!getTelemetryStatus().errorsActive) {
    return null;
  }
  const exceptionValues = event.exception?.values ?? [];
  const firstType = exceptionValues[0]?.type;
  const errorCode = event.tags?.["mcpx.error_code"];
  if ((firstType && EXPECTED_ERROR_TYPES.has(firstType)) || (typeof errorCode === "string" && EXPECTED_ERROR_CODES.has(errorCode))) {
    return null;
  }

  event.message = undefined;
  event.request = undefined;
  event.user = undefined;
  const runtimeName = typeof event.contexts?.runtime?.name === "string" ? event.contexts.runtime.name : undefined;
  event.contexts = {
    ...(runtimeName ? { runtime: { name: runtimeName } } : {}),
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
  event.extra = undefined;
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((breadcrumb) => breadcrumb.category === "mcpx.lifecycle" || breadcrumb.category === "mcpx.operation")
    .map((breadcrumb) => ({
      category: breadcrumb.category,
      level: breadcrumb.level,
      message: breadcrumb.category === "mcpx.lifecycle" ? "lifecycle" : "operation"
    }));

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value) => ({
      type: value.type,
      value: value.type ? "redacted" : undefined,
      mechanism: value.mechanism ? { type: value.mechanism.type, handled: value.mechanism.handled } : undefined,
      stacktrace: value.stacktrace
        ? {
            frames: value.stacktrace.frames?.map((frame) => ({
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

export function initializeNodeErrorReporting(runtime: TelemetryRuntime, release: string): boolean {
  const status = getTelemetryStatus();
  if (!status.errorsActive || initialized) {
    return status.errorsActive;
  }

  const dsn = process.env.MCPX_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) {
    return false;
  }

  try {
    const entrypointRoot = process.argv[1] ? path.dirname(process.argv[1]) : undefined;
    const desktopPlatform = process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : process.platform === "linux"
          ? "linux"
          : "other";
    const sourceMapPrefix = typeof process.versions.electron === "string"
      ? `app:///desktop-cli-${desktopPlatform}/`
      : "app:///cli/";
    Sentry.init({
      dsn,
      release,
      environment: "production",
      sendDefaultPii: false,
      includeLocalVariables: false,
      maxBreadcrumbs: 10,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      integrations: (defaults) => [
        ...defaults,
        ...(entrypointRoot ? [Sentry.rewriteFramesIntegration({ root: entrypointRoot, prefix: sourceMapPrefix })] : [])
      ],
      beforeSend: sanitizeEvent
    });
  } catch {
    return false;
  }

  setTelemetryErrorReporter((error, context) => {
    if (!getTelemetryStatus().errorsActive) return;
    Sentry.withScope((scope) => {
      scope.setTag("mcpx.runtime", context.runtime);
      if (context.operation) scope.setTag("mcpx.operation", context.operation);
      if (context.code) scope.setTag("mcpx.error_code", context.code);
      Sentry.captureException(error);
    });
  });
  initialized = true;
  return true;
}

export async function flushNodeErrorReporting(timeoutMs = 250): Promise<void> {
  if (!initialized || !getTelemetryStatus().errorsActive) return;
  await Promise.race([
    Sentry.flush(timeoutMs),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]).catch(() => undefined);
}

export async function shutdownNodeErrorReporting(_timeoutMs = 250): Promise<void> {
  if (!initialized) return;
  setTelemetryErrorReporter(null);
  const client = Sentry.getClient();
  if (client) {
    // Sentry.close() flushes its pending transport buffer. An explicit opt-out
    // must drop future reports without sending events queued before the choice.
    (client.getOptions() as { enabled?: boolean }).enabled = false;
  }
  initialized = false;
}

export function sanitizeRendererError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error("Renderer error");
  const sanitized = new Error("Renderer error");
  sanitized.name = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(source.name) ? source.name : "Error";
  if (source.stack) {
    sanitized.stack = source.stack
      .split("\n")
      .map((line) => line.replace(/([A-Za-z]:)?[^\s()]+[\\/]src[\\/]/g, "src/"))
      .join("\n");
  }
  return sanitized;
}
