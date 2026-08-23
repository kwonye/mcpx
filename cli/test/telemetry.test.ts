import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  TELEMETRY_NOTICE_VERSION,
  acknowledgeTelemetryNotice,
  captureTelemetryEvent,
  defaultTelemetryPreferences,
  flushTelemetry,
  getTelemetryStatus,
  initializeTelemetry,
  loadTelemetryPreferences,
  resetTelemetryInstallationId,
  shutdownTelemetry,
  updateTelemetryPreferences,
  validateTelemetryEvent
} from "../src/core/telemetry.js";
import { getTelemetryPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("anonymous telemetry preferences", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    process.env.MCPX_TELEMETRY_ALLOW_TESTING = "1";
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    delete process.env.MCPX_POSTHOG_PROJECT_TOKEN;
    delete process.env.MCPX_SENTRY_DSN;
    delete process.env.MCPX_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    delete process.env.MCPX_TELEMETRY_ALLOW_TESTING;
  });

  it("starts dormant and acknowledges the disclosure before generating an ID", () => {
    const env = setupTempEnv("mcpx-telemetry-");
    cleanups.push(env.restore);

    const initial = loadTelemetryPreferences();
    expect(initial).toEqual(defaultTelemetryPreferences());
    expect(getTelemetryStatus().blockedReason).toBe("notice_required");

    const acknowledged = acknowledgeTelemetryNotice();
    expect(acknowledged.noticeAcknowledgedVersion).toBe(TELEMETRY_NOTICE_VERSION);
    expect(acknowledged.installationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("deletes the installation ID when usage analytics is disabled", () => {
    const env = setupTempEnv("mcpx-telemetry-disable-");
    cleanups.push(env.restore);
    acknowledgeTelemetryNotice();

    updateTelemetryPreferences({ usageAnalyticsEnabled: false });
    const disabled = loadTelemetryPreferences();
    expect(disabled.usageAnalyticsEnabled).toBe(false);
    expect(disabled.installationId).toBeNull();
    expect(disabled.milestones.first_server_added).toBe(false);

    updateTelemetryPreferences({ usageAnalyticsEnabled: true });
    expect(loadTelemetryPreferences().installationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("resets to a new ID without exposing the old value", () => {
    const env = setupTempEnv("mcpx-telemetry-reset-");
    cleanups.push(env.restore);
    acknowledgeTelemetryNotice();
    const before = loadTelemetryPreferences().installationId;

    const after = resetTelemetryInstallationId();
    expect(after.installationId).toBeTruthy();
    expect(after.installationId).not.toBe(before);
  });

  it("hard-disables both providers through privacy environment overrides", () => {
    const env = setupTempEnv("mcpx-telemetry-env-");
    cleanups.push(env.restore);
    acknowledgeTelemetryNotice();
    process.env.MCPX_POSTHOG_PROJECT_TOKEN = "test-token";
    process.env.MCPX_SENTRY_DSN = "https://public@example.invalid/1";
    expect(getTelemetryStatus().usageActive).toBe(true);
    expect(getTelemetryStatus().errorsActive).toBe(true);

    process.env.DO_NOT_TRACK = "1";
    const disabled = getTelemetryStatus();
    expect(disabled.usageActive).toBe(false);
    expect(disabled.errorsActive).toBe(false);
  });

  it("recovers from malformed state without enabling collection", () => {
    const env = setupTempEnv("mcpx-telemetry-corrupt-");
    cleanups.push(env.restore);
    fs.mkdirSync(path.dirname(getTelemetryPath()), { recursive: true });
    fs.writeFileSync(getTelemetryPath(), "{not json", "utf8");

    expect(loadTelemetryPreferences()).toEqual(defaultTelemetryPreferences());
    expect(getTelemetryStatus().blockedReason).toBe("notice_required");
  });

  it("honors MCPX_TELEMETRY_DISABLED as an unconditional override", () => {
    const env = setupTempEnv("mcpx-telemetry-disabled-");
    cleanups.push(env.restore);
    acknowledgeTelemetryNotice();
    process.env.MCPX_POSTHOG_PROJECT_TOKEN = "test-token";
    process.env.MCPX_SENTRY_DSN = "https://public@example.invalid/1";
    process.env.MCPX_TELEMETRY_DISABLED = "1";

    const disabled = getTelemetryStatus();
    expect(disabled.usageActive).toBe(false);
    expect(disabled.errorsActive).toBe(false);
    expect(disabled.blockedReason).toBe("environment");
  });

  it("rejects unknown events and prohibited payload fields before transmission", () => {
    expect(validateTelemetryEvent({
      name: "runtime_started",
      properties: {
        runtime: "cli",
        version: "1.2.3",
        osFamily: "macos",
        architecture: "arm64",
        launchMode: "status",
        serverName: "secret-server",
        url: "https://private.example.test"
      }
    })).toBeNull();

    expect(validateTelemetryEvent({
      name: "unknown_event",
      properties: { prompt: "do not send this" }
    })).toBeNull();

    expect(validateTelemetryEvent({
      name: "operation_completed",
      properties: {
        operation: "client_sync",
        outcome: "failure",
        errorCode: "unreachable",
        durationBucket: "lt_1s"
      }
    })).toEqual({
      name: "operation_completed",
      properties: {
        operation: "client_sync",
        outcome: "failure",
        errorCode: "unreachable",
        durationBucket: "lt_1s"
      }
    });
  });

  async function assertRuntimePayload(runtime: "desktop" | "cli" | "daemon"): Promise<void> {
    const env = setupTempEnv(`mcpx-telemetry-collector-${runtime}-`);
    cleanups.push(env.restore);

    let received: Record<string, unknown> | null = null;
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = request.headers["content-encoding"] === "gzip"
          ? gunzipSync(raw).toString("utf8")
          : raw.toString("utf8");
        received = JSON.parse(body) as Record<string, unknown>;
        response.statusCode = 200;
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fake collector did not bind");

    process.env.MCPX_POSTHOG_PROJECT_TOKEN = "fake-project-token";
    process.env.MCPX_POSTHOG_HOST = `http://127.0.0.1:${address.port}`;
    acknowledgeTelemetryNotice();
    initializeTelemetry(runtime, { release: "1.2.3", platform: "test", architecture: "arm64" });
    captureTelemetryEvent({
      name: "runtime_started",
      properties: {
        runtime,
        version: "1.2.3",
        osFamily: "other",
        architecture: "arm64",
        launchMode: "status"
      }
    });
    await flushTelemetry(1_000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await shutdownTelemetry();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const batch = (received?.batch as Array<Record<string, unknown>> | undefined) ?? [];
    expect(batch).toHaveLength(1);
    const event = batch[0];
    expect(event?.event).toBe("runtime_started");
    expect(event?.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event?.properties).toMatchObject({
      runtime,
      version: "1.2.3",
      "$process_person_profile": false,
      "$ip": 0,
      "$geoip_disable": true
    });
    expect(event?.properties).not.toHaveProperty("serverName");
    expect(event?.properties).not.toHaveProperty("url");
  }

  it("sends only the documented personless desktop payload to a local collector", async () => {
    await assertRuntimePayload("desktop");
  });

  it("sends only the documented personless CLI payload to a local collector", async () => {
    await assertRuntimePayload("cli");
  });

  it("sends only the documented personless daemon payload to a local collector", async () => {
    await assertRuntimePayload("daemon");
  });
});
