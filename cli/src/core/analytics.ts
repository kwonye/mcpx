/**
 * PostHog analytics for mcpx CLI.
 *
 * Uses a stable anonymous machine ID so events can be correlated across CLI
 * invocations without collecting any personally-identifiable information.
 * The PostHog client is configured with flushAt=1 / flushInterval=0 because
 * every CLI command is a short-lived process; call `shutdown()` (re-exported
 * below) before the process exits so enqueued events are not silently dropped.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PostHog } from "posthog-node";
import { getConfigRoot, ensureParentDir } from "./paths.js";

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

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;

  if (!POSTHOG_API_KEY) {
    if (process.env.NODE_ENV !== "production") {
      process.stderr.write(
        "[mcpx] POSTHOG_API_KEY variable required by PostHog is missing or un-configured, " +
          "this causes events to be silently missed. " +
          "This error stops appearing once POSTHOG_API_KEY is configured.\n"
      );
    }
    return null;
  }

  _client = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });

  return _client;
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
  const client = getClient();
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
  const client = getClient();
  if (!client) return;

  client.captureException(error, getMachineId(), additionalProperties);
}

/**
 * Flush all pending events and shut down the PostHog client.
 * Must be awaited before the CLI process exits.
 */
export async function shutdown(): Promise<void> {
  if (!_client) return;
  try {
    await _client.shutdown();
  } catch {
    // Never let analytics teardown crash the CLI.
  }
}
