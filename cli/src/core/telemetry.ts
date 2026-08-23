import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { PostHog } from "posthog-node";
import { z } from "zod";
import { ensureParentDir, getTelemetryPath } from "./paths.js";

export const TELEMETRY_NOTICE_VERSION = 1;

const runtimeSchema = z.enum(["desktop", "cli", "daemon"]);
const osFamilySchema = z.enum(["macos", "windows", "linux", "other"]);
const architectureSchema = z.string().regex(/^[a-z0-9_-]{1,16}$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/);
const launchModeSchema = z.enum([
  "add", "remove", "enable", "disable", "list", "sync", "status", "doctor", "daemon", "secret",
  "auth", "clients", "skill", "plugin-host", "proxy", "mcp", "update", "project", "plugin", "telemetry", "desktop", "other"
]);
const outcomeSchema = z.enum(["success", "failure"]);
const errorCodeSchema = z.enum([
  "auth_required",
  "auth_expired",
  "auth_cancelled",
  "daemon_restart_failed",
  "invalid_pid",
  "pid_not_found",
  "rollback_failed",
  "secret_missing",
  "sync_error",
  "timeout",
  "unreachable",
  "upstream_error",
  "unexpected_error",
  "update_check_failed",
  "update_check_timeout",
  "update_failed",
  "validation_error"
]);
const durationBucketSchema = z.enum(["lt_100ms", "lt_1s", "lt_10s", "gte_10s"]);
const methodFamilySchema = z.enum(["tools_call", "resources_read", "prompts_get", "other"]);
const bucketSchema = z.enum(["0", "1", "2_5", "6_20", "21_plus"]);
const uptimeBucketSchema = z.enum(["lt_1h", "1_6h", "6_24h", "gte_24h"]);

const operationSchema = z.enum([
  "server_add",
  "server_update",
  "server_remove",
  "server_toggle",
  "client_sync",
  "auth_login",
  "auth_logout",
  "daemon_start",
  "daemon_stop",
  "daemon_restart",
  "update_check",
  "update_install",
  "update_rollback",
  "project_init",
  "project_remove",
  "skill_add",
  "skill_remove",
  "plugin_install",
  "plugin_update",
  "plugin_uninstall",
  "plugin_toggle",
  "marketplace_add",
  "marketplace_refresh",
  "marketplace_remove"
]);

const tabSchema = z.enum(["servers", "projects", "plugins", "settings"]);
const milestoneSchema = z.enum([
  "first_server_added",
  "first_sync_succeeded",
  "first_gateway_request_succeeded"
]);

const telemetryFileSchema = z.object({
  schemaVersion: z.literal(1),
  usageAnalyticsEnabled: z.boolean(),
  errorReportingEnabled: z.boolean(),
  noticeAcknowledgedVersion: z.number().int().nonnegative(),
  installationId: z.string().uuid().nullable(),
  milestones: z.object({
    first_server_added: z.boolean(),
    first_sync_succeeded: z.boolean(),
    first_gateway_request_succeeded: z.boolean()
  }).strict()
}).strict();

export type TelemetryPreferences = z.infer<typeof telemetryFileSchema>;

export type TelemetryEvent =
  | { name: "runtime_started"; properties: { runtime: z.infer<typeof runtimeSchema>; version: string; osFamily: z.infer<typeof osFamilySchema>; architecture: string; launchMode: z.infer<typeof launchModeSchema> } }
  | { name: "activation_milestone"; properties: { milestone: z.infer<typeof milestoneSchema> } }
  | { name: "operation_completed"; properties: { operation: z.infer<typeof operationSchema>; outcome: z.infer<typeof outcomeSchema>; errorCode?: string; durationBucket?: z.infer<typeof durationBucketSchema> } }
  | { name: "gateway_health_summary"; properties: { methodFamily: z.infer<typeof methodFamilySchema>; callCount: z.infer<typeof bucketSchema>; successCount: z.infer<typeof bucketSchema>; errorCount: z.infer<typeof bucketSchema>; configuredServerCount: z.infer<typeof bucketSchema>; configuredClientCount: z.infer<typeof bucketSchema>; configuredPluginCount: z.infer<typeof bucketSchema>; uptime: z.infer<typeof uptimeBucketSchema> } }
  | { name: "desktop_tab_viewed"; properties: { tab: z.infer<typeof tabSchema> } }
  | { name: "update_completed"; properties: { action: "check" | "install" | "rollback"; outcome: z.infer<typeof outcomeSchema>; fromVersion?: string; toVersion?: string } };

export interface TelemetryStatus extends TelemetryPreferences {
  usageActive: boolean;
  errorsActive: boolean;
  blockedReason?: "notice_required" | "environment" | "missing_provider";
}

export type TelemetryRuntime = z.infer<typeof runtimeSchema>;

export interface TelemetryRuntimeMetadata {
  release: string;
  platform?: string;
  architecture?: string;
}

export interface TelemetryErrorContext {
  runtime: TelemetryRuntime;
  operation?: string;
  code?: string;
}

export type TelemetryErrorReporter = (error: unknown, context: TelemetryErrorContext) => void;

const DEFAULT_PREFERENCES: TelemetryPreferences = {
  schemaVersion: 1,
  usageAnalyticsEnabled: true,
  errorReportingEnabled: true,
  noticeAcknowledgedVersion: 0,
  installationId: null,
  milestones: {
    first_server_added: false,
    first_sync_succeeded: false,
    first_gateway_request_succeeded: false
  }
};

let posthog: PostHog | null = null;
let posthogDistinctId: string | null = null;
let telemetryMetadata: TelemetryRuntimeMetadata | null = null;
let errorReporter: TelemetryErrorReporter | null = null;

function telemetryPath(): string {
  return getTelemetryPath();
}

function environmentFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function isTelemetryEnvironmentDisabled(): boolean {
  const runningDevelopmentSource = /[\\/]src[\\/](?:cli|main)\.(?:[cm]?ts|[cm]?js)$/.test(process.argv[1] ?? "");
  const runningElectronDevServer = Boolean(process.env.ELECTRON_RENDERER_URL);
  return environmentFlag(process.env.DO_NOT_TRACK) ||
    environmentFlag(process.env.MCPX_TELEMETRY_DISABLED) ||
    ((environmentFlag(process.env.CI) || environmentFlag(process.env.VITEST) || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development" || runningDevelopmentSource || runningElectronDevServer) && !environmentFlag(process.env.MCPX_TELEMETRY_ALLOW_TESTING)) ||
    (process.env.MCPX_DESKTOP_FLAVOR === "dev" && !environmentFlag(process.env.MCPX_TELEMETRY_ALLOW_TESTING));
}

export function defaultTelemetryPreferences(): TelemetryPreferences {
  return structuredClone(DEFAULT_PREFERENCES);
}

function savePreferences(preferences: TelemetryPreferences): TelemetryPreferences {
  const normalized = telemetryFileSchema.parse(preferences);
  const filePath = telemetryPath();
  ensureParentDir(filePath);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort permissions on platforms without POSIX mode support.
  }
  return normalized;
}

export function loadTelemetryPreferences(): TelemetryPreferences {
  const filePath = telemetryPath();
  if (!fs.existsSync(filePath)) {
    return defaultTelemetryPreferences();
  }

  try {
    const parsed = telemetryFileSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (!parsed.success) {
      return defaultTelemetryPreferences();
    }
    return parsed.data;
  } catch {
    return defaultTelemetryPreferences();
  }
}

function providerConfigured(): boolean {
  return Boolean(process.env.MCPX_POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_PROJECT_TOKEN);
}

function errorProviderConfigured(): boolean {
  return Boolean(process.env.MCPX_SENTRY_DSN || process.env.SENTRY_DSN);
}

export function getTelemetryStatus(): TelemetryStatus {
  const preferences = loadTelemetryPreferences();
  const blockedByEnvironment = isTelemetryEnvironmentDisabled();
  const noticeRequired = preferences.noticeAcknowledgedVersion < TELEMETRY_NOTICE_VERSION;
  const usageActive = !blockedByEnvironment && !noticeRequired && preferences.usageAnalyticsEnabled && providerConfigured();
  const errorsActive = !blockedByEnvironment && !noticeRequired && preferences.errorReportingEnabled && errorProviderConfigured();

  return {
    ...preferences,
    usageActive,
    errorsActive,
    blockedReason: blockedByEnvironment
      ? "environment"
      : noticeRequired
        ? "notice_required"
        : !providerConfigured() && !errorProviderConfigured()
          ? "missing_provider"
          : undefined
  };
}

export function acknowledgeTelemetryNotice(): TelemetryPreferences {
  const current = loadTelemetryPreferences();
  return savePreferences({
    ...current,
    noticeAcknowledgedVersion: TELEMETRY_NOTICE_VERSION,
    installationId: current.usageAnalyticsEnabled ? (current.installationId ?? crypto.randomUUID()) : null
  });
}

export function updateTelemetryPreferences(patch: Partial<Pick<TelemetryPreferences, "usageAnalyticsEnabled" | "errorReportingEnabled">>): TelemetryPreferences {
  const current = loadTelemetryPreferences();
  const next = {
    ...current,
    ...patch
  };
  if (patch.usageAnalyticsEnabled === false) {
    next.installationId = null;
    next.milestones = defaultTelemetryPreferences().milestones;
  }
  if (
    next.usageAnalyticsEnabled &&
    next.noticeAcknowledgedVersion >= TELEMETRY_NOTICE_VERSION &&
    !next.installationId
  ) {
    next.installationId = crypto.randomUUID();
  }
  const saved = savePreferences(next);
  if (!saved.usageAnalyticsEnabled) {
    void shutdownTelemetry();
  }
  return saved;
}

export function resetTelemetryInstallationId(): TelemetryPreferences {
  const current = loadTelemetryPreferences();
  return savePreferences({
    ...current,
    installationId: current.usageAnalyticsEnabled && current.noticeAcknowledgedVersion >= TELEMETRY_NOTICE_VERSION ? crypto.randomUUID() : null,
    milestones: defaultTelemetryPreferences().milestones
  });
}

export function markTelemetryMilestone(milestone: z.infer<typeof milestoneSchema>): boolean {
  try {
    const current = loadTelemetryPreferences();
    if (current.milestones[milestone]) {
      return false;
    }
    savePreferences({
      ...current,
      milestones: {
        ...current.milestones,
        [milestone]: true
      }
    });
    captureTelemetryEvent({ name: "activation_milestone", properties: { milestone } });
    return true;
  } catch {
    // A diagnostics file or provider failure must not fail the user operation.
    return false;
  }
}

function getPostHogToken(): string | undefined {
  return process.env.MCPX_POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_PROJECT_TOKEN;
}

function getPostHogHost(): string {
  return process.env.MCPX_POSTHOG_HOST || process.env.POSTHOG_HOST || "https://eu.i.posthog.com";
}

export function initializeTelemetry(runtime: TelemetryRuntime, metadata: TelemetryRuntimeMetadata): TelemetryStatus {
  telemetryMetadata = metadata;
  const status = getTelemetryStatus();
  if (!status.usageActive || !status.installationId || posthog) {
    return status;
  }

  const token = getPostHogToken();
  if (!token) {
    return status;
  }

  try {
    posthogDistinctId = status.installationId;
    posthog = new PostHog(token, {
      host: getPostHogHost(),
      disableGeoip: true,
      privacyMode: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      flushAt: 20,
      flushInterval: 10_000,
      requestTimeout: 1_000,
      isServer: runtime === "daemon"
    });
  } catch {
    posthog = null;
    posthogDistinctId = null;
  }
  return status;
}

export function setTelemetryErrorReporter(reporter: TelemetryErrorReporter | null): void {
  errorReporter = reporter;
}

export function reportTelemetryError(error: unknown, context: TelemetryErrorContext): void {
  try {
    errorReporter?.(error, context);
  } catch {
    // Diagnostics must never affect the operation being reported.
  }
}

const eventSchemas = {
  runtime_started: z.object({ runtime: runtimeSchema, version: versionSchema, osFamily: osFamilySchema, architecture: architectureSchema, launchMode: launchModeSchema }).strict(),
  activation_milestone: z.object({ milestone: milestoneSchema }).strict(),
  gateway_health_summary: z.object({ methodFamily: methodFamilySchema, callCount: bucketSchema, successCount: bucketSchema, errorCount: bucketSchema, configuredServerCount: bucketSchema, configuredClientCount: bucketSchema, configuredPluginCount: bucketSchema, uptime: uptimeBucketSchema }).strict(),
  desktop_tab_viewed: z.object({ tab: tabSchema }).strict(),
  operation_completed: z.object({ operation: operationSchema, outcome: outcomeSchema, errorCode: errorCodeSchema.optional(), durationBucket: durationBucketSchema.optional() }).strict(),
  update_completed: z.object({ action: z.enum(["check", "install", "rollback"]), outcome: outcomeSchema, fromVersion: versionSchema.optional(), toVersion: versionSchema.optional() }).strict()
} as const;

export function validateTelemetryEvent(event: unknown): TelemetryEvent | null {
  if (!event || typeof event !== "object" || typeof (event as { name?: unknown }).name !== "string") {
    return null;
  }
  const candidate = event as { name: string; properties: unknown };
  const schema = eventSchemas[candidate.name as keyof typeof eventSchemas];
  if (!schema) {
    return null;
  }
  const parsed = schema.safeParse(candidate.properties);
  return parsed.success
    ? { name: candidate.name, properties: parsed.data } as TelemetryEvent
    : null;
}

export function captureTelemetryEvent(event: TelemetryEvent): void {
  const validated = validateTelemetryEvent(event);
  if (!validated) {
    return;
  }
  try {
    const status = getTelemetryStatus();
    if (!status.usageActive || !status.installationId || !posthog || !posthogDistinctId) {
      return;
    }

    const eventProperties = {
      ...validated.properties,
      $process_person_profile: false,
      $ip: 0
    } as Record<string, unknown>;
    if (validated.name === "runtime_started") {
      eventProperties.version = eventProperties.version || telemetryMetadata?.release || "unknown";
      eventProperties.osFamily = eventProperties.osFamily || platformFamily();
      eventProperties.architecture = eventProperties.architecture || telemetryMetadata?.architecture || architecture();
    }
    posthog.capture({
      distinctId: posthogDistinctId,
      event: validated.name,
      properties: eventProperties
    });
  } catch {
    // Diagnostics must never affect the operation being reported.
  }
}

export async function flushTelemetry(timeoutMs = 250): Promise<void> {
  if (!posthog) {
    return;
  }
  if (!getTelemetryStatus().usageActive) {
    await shutdownTelemetry();
    return;
  }
  let flushPromise: Promise<unknown>;
  try {
    flushPromise = posthog.flush();
  } catch {
    return;
  }
  await Promise.race([
    flushPromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]).catch(() => undefined);
}

export async function shutdownTelemetry(): Promise<void> {
  const current = posthog;
  posthog = null;
  posthogDistinctId = null;
  telemetryMetadata = null;
  if (!current) {
    return;
  }
  // Opt-out must discard the in-memory queue before PostHog's shutdown can
  // perform its normal drain/flush behavior.
  try {
    // Mark this client opted out before clearing its queues so any capture
    // already scheduled on the client becomes a no-op as well.
    await current.disable();
  } catch {
    // Queue cleanup below still prevents normal shutdown from draining data.
  }
  for (const queueKey of ["queue", "ai_queue", "ai_capture_queue", "logs_queue"] as const) {
    try {
      current.setPersistedProperty(queueKey as never, null);
    } catch {
      // Queue cleanup is best-effort; capture is already disabled above.
    }
  }
  try {
    await Promise.race([
      current.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, 250))
    ]).catch(() => undefined);
  } catch {
    // Diagnostics must never affect the operation being reported.
  }
}

export function durationBucket(durationMs: number): z.infer<typeof durationBucketSchema> {
  if (durationMs < 100) return "lt_100ms";
  if (durationMs < 1_000) return "lt_1s";
  if (durationMs < 10_000) return "lt_10s";
  return "gte_10s";
}

export function countBucket(value: number): z.infer<typeof bucketSchema> {
  if (value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  return "21_plus";
}

export function uptimeBucket(uptimeMs: number): z.infer<typeof uptimeBucketSchema> {
  const hours = uptimeMs / 3_600_000;
  if (hours < 1) return "lt_1h";
  if (hours < 6) return "1_6h";
  if (hours < 24) return "6_24h";
  return "gte_24h";
}

export function platformFamily(): "macos" | "windows" | "linux" | "other" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "other";
}

export function architecture(): string {
  return os.arch();
}
