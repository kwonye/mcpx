/**
 * PostHog analytics for mcpx CLI.
 *
 * Uses a stable anonymous machine ID so events can be correlated across CLI
 * invocations without collecting any personally-identifiable information.
 * The PostHog client is configured with flushAt=1 / flushInterval=0 because
 * every CLI command is a short-lived process; call `shutdown()` (re-exported
 * below) before the process exits so enqueued events are not silently dropped.
 *
 * The client is created only when POSTHOG_API_KEY is set and telemetry is
 * enabled. Environment opt-outs and the on-disk privacy preferences are
 * checked before that, and a missing key degrades silently.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PostHog } from "posthog-node";
import { getConfigRoot, ensureParentDir } from "./paths.js";
import {
  TELEMETRY_NOTICE_VERSION,
  isTelemetryEnvironmentDisabled,
  loadTelemetryPreferences,
  type TelemetryPreferences
} from "./telemetry.js";

// ---------------------------------------------------------------------------
// Machine ID — stable anonymous identifier stored in the mcpx config dir.
// ---------------------------------------------------------------------------

function getMachineIdPath(): string {
  return path.join(getConfigRoot(), "mcpx", "machine-id");
}

let _machineId: string | null = null;

export function getMachineId(): string {
  if (_machineId) return _machineId;

  const idPath = getMachineIdPath();
  try {
    const existing = fs.readFileSync(idPath, "utf8").trim();
    if (existing) {
      _machineId = existing;
      return _machineId;
    }
  } catch {
    // File does not exist yet — generate a new ID below.
  }

  const id = crypto.randomUUID();
  try {
    ensureParentDir(idPath);
    fs.writeFileSync(idPath, id, { mode: 0o600 });
  } catch {
    // Filesystem write failed — use the in-memory ID for this run.
  }
  _machineId = id;
  return _machineId;
}

// ---------------------------------------------------------------------------
// PostHog singleton client.
// ---------------------------------------------------------------------------

type AnalyticsChannel = "usage" | "errors";

let _client: PostHog | null = null;

function readApiKey(): string {
  return process.env.POSTHOG_API_KEY?.trim() ?? "";
}

function readHost(): string {
  return process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
}

function preferencesAllow(preferences: TelemetryPreferences, channel: AnalyticsChannel): boolean {
  if (preferences.noticeAcknowledgedVersion < TELEMETRY_NOTICE_VERSION) return false;
  return channel === "usage" ? preferences.usageAnalyticsEnabled : preferences.errorReportingEnabled;
}

function getClient(channel: AnalyticsChannel): PostHog | null {
  // Opt-out is checked before the key and before the client exists so a
  // disabled process never constructs PostHog or writes a configuration warning.
  if (isTelemetryEnvironmentDisabled()) return null;

  const apiKey = readApiKey();
  if (!apiKey) return null;

  const preferences = loadTelemetryPreferences();
  if (!preferencesAllow(preferences, channel)) return null;

  if (_client) return _client;

  _client = new PostHog(apiKey, {
    host: readHost(),
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: preferences.errorReportingEnabled,
  });

  return _client;
}

function shouldDiscardQueuedEvents(): boolean {
  if (isTelemetryEnvironmentDisabled() || !readApiKey()) return true;
  const preferences = loadTelemetryPreferences();
  if (preferences.noticeAcknowledgedVersion < TELEMETRY_NOTICE_VERSION) return true;
  return !preferences.usageAnalyticsEnabled && !preferences.errorReportingEnabled;
}

// ---------------------------------------------------------------------------
// Public helpers.
// ---------------------------------------------------------------------------

/**
 * Capture a named event with optional properties.
 * The call is a no-op when PostHog is not configured so the CLI always works.
 */
export function capture(
  event: string,
  properties?: Record<string, unknown>
): void {
  const client = getClient("usage");
  if (!client) return;

  client.capture({
    distinctId: getMachineId(),
    event,
    properties,
  });
}

/**
 * Capture an unhandled exception.
 * The call is a no-op when PostHog is not configured.
 */
export function captureException(error: unknown, additionalProperties?: Record<string, unknown>): void {
  const client = getClient("errors");
  if (!client) return;

  client.captureException(error, getMachineId(), additionalProperties);
}

/**
 * Flush all pending events and shut down the PostHog client.
 * Must be awaited before the CLI process exits.
 */
export async function shutdown(): Promise<void> {
  const client = _client;
  _client = null;
  if (!client) return;
  try {
    if (shouldDiscardQueuedEvents()) {
      // disable() drops the in-memory queue so shutdown cannot flush events
      // captured before an opt-out in the same process.
      try {
        await client.disable();
      } catch {
        // Queue cleanup below still prevents a normal shutdown from draining.
      }
      for (const queueKey of ["queue", "ai_queue", "ai_capture_queue", "logs_queue"] as const) {
        try {
          client.setPersistedProperty(queueKey as never, null);
        } catch {
          // Queue cleanup is best-effort; capture is already disabled above.
        }
      }
    }
    await client.shutdown();
  } catch {
    // Never let analytics teardown crash the CLI.
  }
}
