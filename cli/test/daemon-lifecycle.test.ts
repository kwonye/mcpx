// Lifecycle tests with real daemon child processes in temp homes on
// non-default ports. Nothing here touches launchd/systemd/Task Scheduler:
// the service-delegation test injects a fake runner that plays supervisor.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import {
  DaemonPortInUseError,
  getDaemonStatus,
  probeDaemonStatus,
  restartDaemon,
  startDaemon,
  stopDaemon,
  stopDaemonAsync
} from "../src/core/daemon.js";
import { getConfigPath, getControlEndpoint, getLogPath, getPidPath, getRuntimeRecordPath } from "../src/core/paths.js";
import { SecretsManager } from "../src/core/secrets.js";
import { DAEMON_EXIT_ALREADY_RUNNING, LAUNCHD_LABEL } from "../src/service/constants.js";
import { readRuntimeRecord, writeRuntimeRecord } from "../src/service/endpoint.js";
import { isPidAlive, isPortAvailable, rotateLogIfNeeded, waitFor } from "../src/service/process.js";
import type { CommandRunner } from "../src/service/runner.js";
import { APP_VERSION } from "../src/version.js";
import { setupTempEnv } from "./helpers.js";

const CLI_PATH = path.join(import.meta.dir, "..", "src", "cli.ts");
const TOKEN = "test-local-token";
const TEST_TIMEOUT = 60_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function health(port: number): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return await response.json() as Record<string, unknown>;
}

describe("daemon lifecycle (real processes)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  async function setup() {
    const env = setupTempEnv("mcpx-life-");
    const previous = { MCPX_NO_UPDATE: process.env.MCPX_NO_UPDATE, MCPX_TELEMETRY_DISABLED: process.env.MCPX_TELEMETRY_DISABLED };
    process.env.MCPX_NO_UPDATE = "1";
    process.env.MCPX_TELEMETRY_DISABLED = "1";
    const config = defaultConfig();
    config.gateway.port = await freePort();
    saveConfig(config);
    const secrets = new SecretsManager();
    cleanups.push(() => {
      env.restore();
      process.env.MCPX_TELEMETRY_DISABLED = previous.MCPX_TELEMETRY_DISABLED;
    });
    // Registered after restore so it runs first, while the temp env is still active.
    cleanups.push(async () => {
      const record = readRuntimeRecord();
      await stopDaemonAsync({ service: false, timeoutMs: 3000 }).catch(() => undefined);
      if (record && isPidAlive(record.pid)) process.kill(record.pid, "SIGKILL");
    });
    return { config, secrets, root: env.root };
  }

  function spawnDaemonRun(port: number): ChildProcess {
    return spawn(process.execPath, [CLI_PATH, "daemon", "run", "--port", String(port)], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  it("owns its identity: writes the runtime record, reports version and instanceId on /health, stops verified", async () => {
    const { config, secrets } = await setup();
    const started = await startDaemon(config, CLI_PATH, secrets, { service: false });
    expect(started.started).toBe(true);
    expect(started.port).toBe(config.gateway.port);

    const record = readRuntimeRecord();
    expect(record).toMatchObject({ pid: started.pid, port: config.gateway.port, version: APP_VERSION, instanceId: started.instanceId });
    expect(fs.existsSync(getPidPath())).toBe(false);

    const body = await health(config.gateway.port);
    expect(body).toMatchObject({ ok: true, server: "mcpx", version: APP_VERSION, instanceId: started.instanceId });

    expect(getDaemonStatus(config)).toMatchObject({ running: true, pid: started.pid, instanceId: started.instanceId, verified: false });
    expect(await probeDaemonStatus(config)).toMatchObject({ running: true, pid: started.pid, instanceId: started.instanceId, verified: true });

    const again = await startDaemon(config, CLI_PATH, secrets, { service: false });
    expect(again).toMatchObject({ started: false, pid: started.pid, message: "mcpx daemon already running." });

    const stopped = stopDaemon({ service: false });
    expect(stopped).toMatchObject({ stopped: true, pid: started.pid, forced: false });
    expect(fs.existsSync(getRuntimeRecordPath())).toBe(false);
    expect(fs.existsSync(getControlEndpoint())).toBe(false);
    expect(await isPortAvailable(config.gateway.port)).toBe(true);
    expect(await waitFor(() => !isPidAlive(started.pid), 3000)).toBe(true);
    expect(getDaemonStatus(config).running).toBe(false);
    expect(stopDaemon({ service: false })).toMatchObject({ stopped: false, message: "mcpx daemon is not running." });
  }, TEST_TIMEOUT);

  it("refuses to run a second daemon with a distinct exit code", async () => {
    const { config, secrets } = await setup();
    const started = await startDaemon(config, CLI_PATH, secrets, { service: false });

    const second = spawnDaemonRun(await freePort());
    let stderr = "";
    second.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve) => second.once("exit", resolve));
    expect(code).toBe(DAEMON_EXIT_ALREADY_RUNNING);
    expect(stderr).toContain("Another mcpx daemon is already running");
    expect(stderr).toContain(`pid ${started.pid}`);

    // The first daemon is untouched.
    expect((await health(config.gateway.port)).instanceId).toBe(started.instanceId);
  }, TEST_TIMEOUT);

  it("recovers the stale runtime record and socket left by a daemon killed with -9", async () => {
    const { config, secrets } = await setup();
    const first = await startDaemon(config, CLI_PATH, secrets, { service: false });
    process.kill(first.pid, "SIGKILL");
    expect(await waitFor(() => !isPidAlive(first.pid), 5000)).toBe(true);
    expect(readRuntimeRecord()?.instanceId).toBe(first.instanceId);
    if (process.platform !== "win32") expect(fs.existsSync(getControlEndpoint())).toBe(true);
    expect(getDaemonStatus(config).running).toBe(false);
    expect(await probeDaemonStatus(config)).toMatchObject({ running: false, verified: true });

    const second = await startDaemon(config, CLI_PATH, secrets, { service: false });
    expect(second.started).toBe(true);
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(readRuntimeRecord()?.instanceId).toBe(second.instanceId);
  }, TEST_TIMEOUT);

  it("is not blocked by a reused pid in the runtime record or the legacy pid file", async () => {
    const { config, secrets } = await setup();
    // A live, unrelated process (this test runner) is named in both files.
    writeRuntimeRecord({
      schema: 1,
      pid: process.pid,
      port: config.gateway.port,
      version: "0.0.1",
      startedAt: new Date().toISOString(),
      instanceId: "stale-instance-id",
      endpoint: getControlEndpoint()
    });
    fs.writeFileSync(getPidPath(), `${process.pid}:${config.gateway.port}\n`);

    const started = await startDaemon(config, CLI_PATH, secrets, { service: false });
    expect(started.started).toBe(true);
    expect(started.pid).not.toBe(process.pid);
    expect(fs.existsSync(getPidPath())).toBe(false);
    expect(readRuntimeRecord()?.instanceId).toBe(started.instanceId);
  }, TEST_TIMEOUT);

  it("stopping frees the port even while a keep-alive connection is open", async () => {
    const { config, secrets } = await setup();
    const started = await startDaemon(config, CLI_PATH, secrets, { service: false });

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(() => agent.destroy());
    await new Promise<void>((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port: config.gateway.port, path: "/health", agent, headers: { Authorization: `Bearer ${TOKEN}` } }, (response) => {
        response.resume();
        response.on("end", () => resolve());
      });
      request.on("error", reject);
    });
    // The idle keep-alive socket is still open.
    expect(Object.values(agent.freeSockets).flat().length).toBe(1);

    const stopStartedAt = Date.now();
    const stopped = await stopDaemonAsync({ service: false });
    expect(stopped).toMatchObject({ stopped: true, forced: false, pid: started.pid });
    expect(await isPortAvailable(config.gateway.port)).toBe(true);
    // Well under the daemon's 5s shutdown ceiling: open connections were dropped, not waited on.
    expect(Date.now() - stopStartedAt).toBeLessThan(2500);
  }, TEST_TIMEOUT);

  it("fails loudly on a port conflict without changing the config", async () => {
    const { config, secrets } = await setup();
    const squatter = net.createServer();
    await new Promise<void>((resolve) => squatter.listen(config.gateway.port, "127.0.0.1", () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => squatter.close(() => resolve())));
    const before = fs.readFileSync(getConfigPath(), "utf8");

    const error = await startDaemon(config, CLI_PATH, secrets, { service: false }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DaemonPortInUseError);
    expect((error as Error).message).toContain(`Port ${config.gateway.port} is already in use`);
    expect(fs.readFileSync(getConfigPath(), "utf8")).toBe(before);
    expect(readRuntimeRecord()).toBeNull();

    // The daemon process itself also refuses (exit 78) rather than moving.
    const direct = spawnSync(process.execPath, [CLI_PATH, "daemon", "run", "--port", String(config.gateway.port)], { env: { ...process.env }, encoding: "utf8", timeout: 30_000 });
    expect(direct.status).toBe(78);
    expect(direct.stderr).toContain(`Port ${config.gateway.port} is already in use`);
    expect(fs.readFileSync(getConfigPath(), "utf8")).toBe(before);
  }, TEST_TIMEOUT);

  it("restart replaces the daemon after a verified stop", async () => {
    const { config, secrets } = await setup();
    const first = await startDaemon(config, CLI_PATH, secrets, { service: false });
    const second = await restartDaemon(config, CLI_PATH, secrets, { service: false });
    expect(second.started).toBe(true);
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(isPidAlive(first.pid)).toBe(false);
    expect((await health(config.gateway.port)).instanceId).toBe(second.instanceId);
  }, TEST_TIMEOUT);

  it("delegates start/stop to an installed service manager instead of spawning", async () => {
    const { config, secrets, root } = await setup();
    // An installed LaunchAgent definition (file only); the fake runner plays launchd.
    const plist = path.join(root, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "<plist/>");
    const calls: string[] = [];
    let supervised: ChildProcess | null = null;
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args].join(" "));
      if (args[0] === "kickstart") supervised = spawnDaemonRun(config.gateway.port);
      return { code: 0, stdout: "", stderr: "" };
    };
    cleanups.push(() => { supervised?.kill("SIGKILL"); });
    const service = { platform: "darwin" as const, homeDir: root, uid: 501, runner };

    const started = await startDaemon(config, CLI_PATH, secrets, { service });
    expect(started).toMatchObject({ started: true, supervisor: "launchd" });
    expect(started.pid).toBe((supervised as ChildProcess | null)?.pid ?? -1);
    expect(calls).toEqual([`launchctl print gui/501/${LAUNCHD_LABEL}`, `launchctl kickstart gui/501/${LAUNCHD_LABEL}`]);
    if (process.platform === "darwin") expect(getDaemonStatus(config).service).toBe("launchd");

    // Stop asks the daemon itself (exit 0, so KeepAlive does not restart it); no bootout needed.
    const stopped = await stopDaemonAsync({ service });
    expect(stopped).toMatchObject({ stopped: true, forced: false, supervisor: "launchd" });
    expect(calls).toHaveLength(2);
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = supervised as ChildProcess | null;
      if (!child || child.exitCode !== null) resolve(child?.exitCode ?? null);
      else child.once("exit", resolve);
    });
    expect(exitCode).toBe(0);
  }, TEST_TIMEOUT);
});

describe("log rotation", () => {
  it("rotates by size in place (copy + truncate) so an open append handle keeps working", () => {
    const env = setupTempEnv("mcpx-log-");
    try {
      const logPath = getLogPath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const fd = fs.openSync(logPath, "a");
      fs.writeSync(fd, "x".repeat(2048));
      expect(rotateLogIfNeeded(logPath, 1024)).toBe(true);
      expect(fs.statSync(logPath).size).toBe(0);
      expect(fs.statSync(`${logPath}.1`).size).toBe(2048);
      fs.writeSync(fd, "after\n");
      expect(fs.readFileSync(logPath, "utf8")).toBe("after\n");

      fs.writeSync(fd, "y".repeat(2048));
      expect(rotateLogIfNeeded(logPath, 1024)).toBe(true);
      expect(fs.statSync(`${logPath}.2`).size).toBe(2048);
      expect(rotateLogIfNeeded(logPath, 1024)).toBe(false);
      fs.closeSync(fd);
    } finally {
      env.restore();
    }
  });
});
