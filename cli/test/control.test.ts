import { describe, it, expect } from "bun:test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { listOperations, saveOperation, type Operation } from "../src/core/operations.js";
import { setupTempEnv } from "./helpers.js";
import { coordinate, startControlServer, controlRequest, controlConnectOptions, subscribeControlEvents } from "../src/core/control.js";
import { loadConfig } from "../src/core/config.js";
import { mutateConfig } from "../src/core/config-store.js";
import { runtimeConfig } from "../src/core/runtime-snapshot.js";

describe("local management coordinator", () => {
  it("reports nested sync failures and publishes committed changes after failed work", async () => {
    const env = setupTempEnv("control-partial-");
    const stop = await startControlServer();
    try {
      fs.mkdirSync(path.join(env.root, ".pi/agent/mcp.json"), { recursive: true });
      const result = await controlRequest<any>("server.add", ["echo", { transport: "stdio", command: "node" }]);
      expect(result.sync.hasErrors).toBe(true);
      expect(listOperations().find(operation => operation.label === "server.add")?.phase).toBe("failed");
      const snapshot = await controlRequest<any>("snapshot");
      expect(snapshot.harnesses.find((h: any) => h.id === "pi").sync.status).toBe("ERROR");
      await expect(coordinate(async () => {
        await mutateConfig(config => { config.servers.echo.enabled = false; });
        throw new Error("projection failed after commit");
      })).rejects.toThrow("projection failed");
      expect(runtimeConfig().servers.echo.enabled).toBe(false);
    } finally { await stop(); env.restore(); }
  });

  it("adopts an integration installed later when its harness enables automatic mode", async () => {
    const env = setupTempEnv("control-automatic-");
    const stop = await startControlServer();
    try {
      await controlRequest("harness.mode", ["pi", "automatic"]);
      const native = path.join(process.env.HOME!, ".pi/agent/mcp.json");
      fs.mkdirSync(path.dirname(native), { recursive: true });
      fs.writeFileSync(native, JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/mock-stdio-mcp-server.cjs", import.meta.url))] } } }));
      const time = new Date().toISOString();
      const interrupted: Operation = { id: crypto.randomUUID(), label: "Interrupted adoption", phase: "recovery-required", startedAt: time, updatedAt: time, progress: 0 };
      saveOperation(interrupted);
      await new Promise(resolve => setTimeout(resolve, 3400));
      expect(loadConfig().servers.echo).toBeUndefined();
      interrupted.phase = "rolled-back";
      saveOperation(interrupted);
      const deadline = Date.now() + 12000;
      while (!loadConfig().servers.echo && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      expect(loadConfig().servers.echo?.transport).toBe("stdio");
      const projected = JSON.parse(fs.readFileSync(native, "utf8"));
      expect(projected.mcpServers.echo).toBeUndefined();
      expect(projected.mcpServers.echo__mcpx.url).toContain("/mcp?upstream=echo");
    } finally { await stop(); env.restore(); }
  }, 15000);

  it("authenticates the socket, serializes worker leases, and broadcasts operation progress", async () => {
    const env = setupTempEnv("control-service-");
    const stop = await startControlServer();
    let unsubscribe = () => {};
    try {
      const unauthorized = await new Promise<number>(resolve => { const request = http.get({ ...controlConnectOptions(), path: "/v1/events" }, response => { response.resume(); resolve(response.statusCode!); }); request.on("error", () => resolve(0)); });
      expect(unauthorized).toBe(403);
      const events: string[] = [];
      unsubscribe = subscribeControlEvents(event => { if (event.operation) events.push(event.operation.phase); });
      await new Promise(resolve => setTimeout(resolve, 20));
      const lease = await controlRequest<string>("lease.acquire", [process.pid, "test worker"]);
      let completed = false;
      const pending = controlRequest("harness.mode", ["pi", "automatic"]).then(() => { completed = true; });
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(completed).toBe(false);
      await controlRequest("lease.release", [lease]);
      await pending;
      expect(loadConfig().harnesses?.pi.mode).toBe("automatic");
      expect(events).toContain("applying");
      await expect(startControlServer()).rejects.toThrow("already running");
      expect(await controlRequest("snapshot")).toHaveProperty("harnesses");
      expect(await controlRequest("adoption.plan", [undefined])).toHaveProperty("items");
    } finally { unsubscribe(); await stop(); env.restore(); }
  });
});
