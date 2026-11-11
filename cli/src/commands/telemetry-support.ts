/**
 * Telemetry plumbing for the CLI entry point and command modules.
 */
import {
  acknowledgeTelemetryNotice,
  captureTelemetryEvent,
  durationBucket,
  getTelemetryStatus,
  type TelemetryEvent
} from "../core/telemetry.js";

type TelemetryLaunchMode = Extract<TelemetryEvent, { name: "runtime_started" }>["properties"]["launchMode"];
type TelemetryOperation = Extract<TelemetryEvent, { name: "operation_completed" }>["properties"]["operation"];

export function telemetryLaunchMode(rawArgs: string[]): TelemetryLaunchMode {
  const known = new Set<TelemetryLaunchMode>([
    "add", "remove", "enable", "disable", "list", "sync", "status", "doctor", "daemon", "secret",
    "auth", "clients", "skill", "plugin-host", "proxy", "mcp", "update", "project", "plugin", "telemetry"
  ]);
  const candidate = rawArgs[0] as TelemetryLaunchMode | undefined;
  return candidate && known.has(candidate) ? candidate : "other";
}

export function telemetryOperation(rawArgs: string[]): Extract<TelemetryEvent, { name: "operation_completed" }>['properties']['operation'] | null {
  const [group, action] = rawArgs;
  if (group === "add" || (group === "mcp" && action === "add")) return "server_add";
  if (group === "remove" || (group === "mcp" && action === "remove")) return "server_remove";
  if (group === "enable" || group === "disable" || (group === "mcp" && (action === "enable" || action === "disable"))) return "server_toggle";
  if (group === "sync" || (group === "mcp" && action === "sync")) return "client_sync";
  if (group === "auth" && action === "login") return "auth_login";
  if (group === "auth" && action === "logout") return "auth_logout";
  if (group === "daemon" && (action === "start" || action === "stop" || action === "restart")) return `daemon_${action}` as "daemon_start" | "daemon_stop" | "daemon_restart";
  if (group === "update" && (action === "check" || action === "install" || action === "rollback")) return `update_${action}` as "update_check" | "update_install" | "update_rollback";
  if (group === "project" && (action === "init" || action === "remove")) return `project_${action}` as "project_init" | "project_remove";
  if (group === "skill" && (action === "add" || action === "rm")) return action === "add" ? "skill_add" : "skill_remove";
  if (group === "plugin" && (action === "install" || action === "update" || action === "uninstall")) return `plugin_${action}` as "plugin_install" | "plugin_update" | "plugin_uninstall";
  if (group === "plugin" && (action === "enable" || action === "disable")) return "plugin_toggle";
  if (group === "plugin" && action === "marketplace" && (rawArgs[2] === "add" || rawArgs[2] === "update" || rawArgs[2] === "remove")) {
    return rawArgs[2] === "update" ? "marketplace_refresh" : `marketplace_${rawArgs[2]}` as "marketplace_add" | "marketplace_remove";
  }
  return null;
}

export function telemetryErrorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof candidate === "string" && [
    "auth_required", "auth_expired", "auth_cancelled", "daemon_restart_failed", "invalid_pid",
    "pid_not_found", "rollback_failed", "secret_missing", "sync_error", "timeout", "unreachable",
    "upstream_error", "unexpected_error", "update_check_failed", "update_check_timeout", "update_failed",
    "validation_error"
  ].includes(candidate)) {
    return candidate;
  }
  if (error instanceof Error && error.name === "OAuthCancelledError") return "auth_cancelled";
  if (error instanceof Error && (error.name === "ZodError" || error.name === "ValidationError")) return "validation_error";
  if (error instanceof Error && error.name === "SecretNotFoundError") return "secret_missing";
  return "unexpected_error";
}

export function recordTelemetryOperationFailure(operation: TelemetryOperation, error: unknown, startedAt: number): void {
  captureTelemetryEvent({
    name: "operation_completed",
    properties: {
      operation,
      outcome: "failure",
      errorCode: telemetryErrorCode(error),
      durationBucket: durationBucket(Date.now() - startedAt)
    }
  });
}

function shouldShowTelemetryNotice(rawArgs: string[]): boolean {
  const explicitlyEnablingTelemetry = rawArgs[0] === "telemetry" && rawArgs[1] === "enable";
  return !rawArgs.includes("--json")
    && (rawArgs[0] !== "telemetry" || explicitlyEnablingTelemetry)
    && Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export function showCliTelemetryNotice(rawArgs: string[]): void {
  const status = getTelemetryStatus();
  if (status.noticeAcknowledgedVersion >= 1 || status.blockedReason === "environment" || !shouldShowTelemetryNotice(rawArgs)) {
    return;
  }
  process.stderr.write("mcpx collects anonymous usage analytics and crash diagnostics to improve reliability.\n");
  process.stderr.write("It does not collect server names, prompts, results, URLs, paths, secrets, or raw error messages. Native crash dumps may contain process-memory fragments.\n");
  process.stderr.write("Change this any time with `mcpx telemetry status`, `mcpx telemetry disable`, or `mcpx telemetry reset-id`.\n\n");
  if (!(rawArgs[0] === "telemetry" && rawArgs[1] === "enable")) {
    try {
      acknowledgeTelemetryNotice();
    } catch {
      // A read-only config directory must not change the command's outcome.
    }
  }
}
