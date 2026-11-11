import http from "node:http";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "bun:test";
import { capture, captureException, shutdown } from "../src/core/analytics.js";
import { acknowledgeTelemetryNotice, updateTelemetryPreferences } from "../src/core/telemetry.js";
import { setupTempEnv } from "./helpers.js";

const ANALYTICS_ENV_KEYS = [
  "POSTHOG_API_KEY",
  "POSTHOG_HOST",
  "MCPX_TELEMETRY_DISABLED",
  "DO_NOT_TRACK",
  "MCPX_TELEMETRY_ALLOW_TESTING",
  "NODE_ENV"
] as const;

function restoreEnv(snapshot: Record<(typeof ANALYTICS_ENV_KEYS)[number], string | undefined>): void {
  for (const key of ANALYTICS_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function snapshotEnv(): Record<(typeof ANALYTICS_ENV_KEYS)[number], string | undefined> {
  return {
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    MCPX_TELEMETRY_DISABLED: process.env.MCPX_TELEMETRY_DISABLED,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
    MCPX_TELEMETRY_ALLOW_TESTING: process.env.MCPX_TELEMETRY_ALLOW_TESTING,
    NODE_ENV: process.env.NODE_ENV
  };
}

interface Collector {
  url: string;
  bodies: () => unknown[];
  close: () => Promise<void>;
}

function startCollector(): Promise<Collector> {
  const bodies: unknown[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const text = request.headers["content-encoding"] === "gzip"
        ? gunzipSync(raw).toString("utf8")
        : raw.toString("utf8");
      try {
        bodies.push(text ? JSON.parse(text) : {});
      } catch {
        bodies.push(text);
      }
      response.statusCode = 200;
      response.end("{}");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("analytics collector did not bind");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        bodies: () => bodies,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

async function expectSilent(run: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalWarn = console.warn;
  const originalError = console.error;
  const record = (value: unknown): void => {
    chunks.push(typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString("utf8"));
  };
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    record(chunk);
    const done = typeof encoding === "function" ? encoding : callback;
    done?.();
    return true;
  }) as typeof process.stderr.write;
  console.warn = (...args: unknown[]) => {
    chunks.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    chunks.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await run();
    return chunks.join("\n");
  } finally {
    process.stderr.write = originalWrite;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function assertNoPostHogWarning(output: string): void {
  expect(output).not.toContain("POSTHOG_API_KEY");
  expect(output).not.toContain("variable required by PostHog");
}

describe("analytics silence", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  let envSnapshot = snapshotEnv();

  afterEach(async () => {
    await shutdown();
    while (cleanups.length > 0) await cleanups.pop()?.();
    restoreEnv(envSnapshot);
  });

  function isolate(name: string): void {
    envSnapshot = snapshotEnv();
    const env = setupTempEnv(name);
    cleanups.push(env.restore);
  }

  async function useCollector(): Promise<Collector> {
    const collector = await startCollector();
    cleanups.push(() => collector.close());
    process.env.POSTHOG_HOST = collector.url;
    return collector;
  }

  function enableTelemetryEnv(): void {
    process.env.MCPX_TELEMETRY_ALLOW_TESTING = "1";
    delete process.env.MCPX_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
  }

  it("stays silent and sends nothing when MCPX_TELEMETRY_DISABLED is set, even with a key", async () => {
    isolate("mcpx-analytics-disabled-");
    const collector = await useCollector();
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.MCPX_TELEMETRY_ALLOW_TESTING = "1";
    process.env.MCPX_TELEMETRY_DISABLED = "1";
    process.env.NODE_ENV = "development";
    acknowledgeTelemetryNotice();

    const output = await expectSilent(async () => {
      capture("marketplace_added", { source_type: "local" });
      captureException(new Error("disabled"));
      await shutdown();
    });

    assertNoPostHogWarning(output);
    expect(collector.bodies()).toEqual([]);
  });

  it("stays silent when DO_NOT_TRACK is set", async () => {
    isolate("mcpx-analytics-dnt-");
    const collector = await useCollector();
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.MCPX_TELEMETRY_ALLOW_TESTING = "1";
    process.env.DO_NOT_TRACK = "1";
    acknowledgeTelemetryNotice();

    const output = await expectSilent(() => {
      capture("plugin_installed", { marketplace: "private-catalog" });
      captureException(new Error("do-not-track"));
    });

    assertNoPostHogWarning(output);
    expect(collector.bodies()).toEqual([]);
  });

  it("does not warn on stderr when the API key is missing", async () => {
    isolate("mcpx-analytics-missing-key-");
    const collector = await useCollector();
    enableTelemetryEnv();
    delete process.env.POSTHOG_API_KEY;
    process.env.NODE_ENV = "development";
    acknowledgeTelemetryNotice();

    const output = await expectSilent(() => {
      capture("server_added", { transport: "stdio" });
      capture("server_added", { transport: "stdio" });
      captureException(new Error("missing-key"));
    });

    assertNoPostHogWarning(output);
    expect(collector.bodies()).toEqual([]);
  });

  it("does not send when usage analytics is disabled in preferences", async () => {
    isolate("mcpx-analytics-preference-");
    const collector = await useCollector();
    enableTelemetryEnv();
    process.env.POSTHOG_API_KEY = "phc_test_key";
    acknowledgeTelemetryNotice();
    updateTelemetryPreferences({ usageAnalyticsEnabled: false });

    const output = await expectSilent(() => {
      capture("daemon_started", { port: 1234 });
    });

    assertNoPostHogWarning(output);
    expect(collector.bodies()).toEqual([]);
  });

  it("does not send before the privacy notice is acknowledged", async () => {
    isolate("mcpx-analytics-notice-");
    const collector = await useCollector();
    enableTelemetryEnv();
    process.env.POSTHOG_API_KEY = "phc_test_key";

    const output = await expectSilent(() => {
      capture("daemon_stopped", {});
      captureException(new Error("before-notice"));
    });

    assertNoPostHogWarning(output);
    expect(collector.bodies()).toEqual([]);
  });

  it("does not capture exceptions when error reporting is disabled", async () => {
    isolate("mcpx-analytics-errors-off-");
    const collector = await useCollector();
    enableTelemetryEnv();
    process.env.POSTHOG_API_KEY = "phc_test_key";
    acknowledgeTelemetryNotice();
    updateTelemetryPreferences({ errorReportingEnabled: false });

    const output = await expectSilent(() => {
      captureException(new Error("secret failure detail"));
    });

    assertNoPostHogWarning(output);
    expect(output).not.toContain("secret failure detail");
    expect(collector.bodies()).toEqual([]);
  });

  it("sends a usage event when a key is configured and telemetry is enabled", async () => {
    isolate("mcpx-analytics-enabled-");
    const collector = await useCollector();
    enableTelemetryEnv();
    process.env.POSTHOG_API_KEY = "phc_test_key";
    process.env.NODE_ENV = "production";
    acknowledgeTelemetryNotice();
    updateTelemetryPreferences({ errorReportingEnabled: false });

    const output = await expectSilent(async () => {
      capture("server_added", { transport: "stdio", from_registry: false, scope: "global" });
      await shutdown();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assertNoPostHogWarning(output);
    const serialized = JSON.stringify(collector.bodies());
    expect(serialized).toContain("server_added");
    expect(serialized).toContain("stdio");
  });
});
