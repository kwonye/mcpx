// Management API of the daemon. It is served on the daemon's single control
// endpoint (service/endpoint.ts: the per-user Unix socket / named pipe that is
// also the single-instance guard), behind a bearer key in the runtime dir.
// Lifecycle (ping/shutdown) lives on the same endpoint, unauthenticated.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { z } from "zod";
import { compileRuntimeSnapshot, clearRuntimeSnapshot } from "./runtime-snapshot.js";
import { getControlEndpoint, getRuntimeDir } from "./paths.js";
import { processAlive } from "./file-state.js";
import { loadConfig } from "./config.js";
import { managementCommand } from "./management.js";
import { listOperations, operationEvents, saveOperation, markInterruptedOperations, type Operation } from "./operations.js";
import { planAdoption, applyAdoption } from "./adoption.js";
import { sha256 } from "../util/fs.js";
import { SecretsManager } from "./secrets.js";
import { acquireInstanceGuard, type InstanceGuard } from "../service/endpoint.js";
import { APP_VERSION } from "../version.js";

export const CONTROL_VERSION = 1;

/** Connection options for the daemon's control endpoint (socket path or named pipe). */
export function controlConnectOptions(): { socketPath: string } {
  return { socketPath: getControlEndpoint() };
}

function controlKey(): string {
  const file = path.join(getRuntimeDir(), "control.key");
  fs.mkdirSync(getRuntimeDir(), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) { try { fs.writeFileSync(file, crypto.randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
  return fs.readFileSync(file, "utf8").trim();
}
function authorized(value: string | undefined): boolean {
  const a = Buffer.from(value ?? ""), b = Buffer.from(`Bearer ${controlKey()}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const requestSchema = z.object({ version: z.literal(1), method: z.string(), args: z.array(z.unknown()).default([]) });
let queue: Promise<unknown> = Promise.resolve();
let activeWriters = 0;
/** Number of coordinated write operations in flight in this process. */
export function activeControlWriters(): number { return activeWriters; }
export function coordinate<T>(work: () => Promise<T>): Promise<T> {
  const execute = async () => {
    activeWriters++;
    try { return await work(); }
    finally {
      try { compileRuntimeSnapshot(); }
      finally { activeWriters--; }
    }
  };
  const next = queue.then(execute, execute);
  queue = next.catch(() => undefined);
  return next;
}
/** Resolves once every coordinated write queued so far has finished (bounded). */
export async function drainCoordinatedWork(timeoutMs = 5000): Promise<void> {
  await Promise.race([queue, new Promise(resolve => setTimeout(resolve, timeoutMs).unref())]);
}

export interface ManagementApi {
  listener: (request: http.IncomingMessage, response: http.ServerResponse) => void;
  close(): Promise<void>;
}

/** Builds the management API (commands, events, leases, automatic adoption) for a control endpoint. */
export function createManagementApi(): ManagementApi {
  controlKey();
  const clients = new Set<http.ServerResponse>();
  const leases = new Map<string, (success?: boolean) => void>();
  const listener = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (request.headers.origin || !authorized(request.headers.authorization)) { response.writeHead(403); response.end(); return; }
    if (request.url === "/v1/events" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ type: "connected", version: CONTROL_VERSION })}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (request.url !== "/v1/command" || request.method !== "POST") { response.writeHead(404); response.end(); return; }
    try {
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Control request is too large"); }
      const input = requestSchema.parse(JSON.parse(body));
      if (input.method === "service.health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ result: { pid: process.pid, activeWriters, version: APP_VERSION } })); return; }
      if (input.method === "lease.release") {
        const [id, success] = z.tuple([z.uuid(), z.boolean().optional()]).parse(input.args);
        leases.get(id)?.(success); leases.delete(id);
        response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ result: true })); return;
      }
      if (input.method === "lease.acquire") {
        const [pid, label] = z.tuple([z.number().int().positive(), z.string()]).parse(input.args);
        const id = crypto.randomUUID();
        let ready!: () => void;
        const started = new Promise<void>(resolve => { ready = resolve; });
        void coordinate(async () => {
          const operation: Operation = { id, label: `CLI ${label}`, phase: "applying", progress: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          saveOperation(operation);
          let succeeded = true;
          await new Promise<void>(resolve => {
            const timer = setInterval(() => { if (!processAlive(pid)) finish(false); }, 1000);
            const finish = (success = true) => { succeeded = success; clearInterval(timer); leases.delete(id); resolve(); };
            leases.set(id, finish); ready();
          });
          operation.phase = succeeded ? "complete" : "failed"; operation.progress = 1; saveOperation(operation);
        });
        await started;
        response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ result: id })); return;
      }
      const work = async () => {
        return managementCommand(input.method, input.args);
      };
      const result = input.method === "snapshot" ? await work() : await coordinate(async () => {
        if (input.method === "adoption.plan") return work();
        const operation: Operation = { id: crypto.randomUUID(), label: input.method, phase: "applying", progress: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        saveOperation(operation);
        try {
          const result = await work();
          const outcome = z.object({ hasErrors: z.boolean().optional(), sync: z.object({ hasErrors: z.boolean() }).optional() }).safeParse(result);
          const failed = outcome.success && (outcome.data.hasErrors || outcome.data.sync?.hasErrors);
          operation.phase = failed ? "failed" : "complete";
          operation.progress = 1;
          if (failed) operation.message = "The integration was saved, but synchronization needs attention. Review the affected harness diagnostics and retry sync.";
          saveOperation(operation);
          return result;
        }
        catch (error) { operation.phase = "failed"; operation.message = "Operation failed. Review the affected integration and retry."; saveOperation(operation); throw error; }
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: CONTROL_VERSION, result }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid management input" : (error as Error).message }));
    }
  };
  const notify = (operation: Operation) => {
    for (const client of clients) client.write(`data: ${JSON.stringify({ type: "operation", operation })}\n\n`);
  };
  operationEvents.on("change", notify);
  markInterruptedOperations();
  compileRuntimeSnapshot();
  let reconciling = false;
  let observedPlan = "";
  const reconcile = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    void coordinate(async () => {
      if (listOperations().some(operation => operation.phase === "recovery-required")) return;
      const config = loadConfig();
      const targets = Object.entries(config.harnesses ?? {}).filter(([, settings]) => settings.mode === "automatic").map(([id]) => id);
      if (!targets.length) return;
      const plan = planAdoption(targets);
      const fingerprint = sha256(JSON.stringify(plan.items));
      if (fingerprint === observedPlan) return;
      observedPlan = fingerprint;
      const safe = plan.items.filter(item => item.action === "import" || item.action === "reuse");
      if (safe.length) await applyAdoption(plan, safe.map(item => item.id));
    }).catch(() => { const time = new Date().toISOString(); saveOperation({ id: crypto.randomUUID(), label: "Automatic adoption", phase: "failed", startedAt: time, updatedAt: time, progress: 0, message: "An installation could not be adopted. Scan existing installs to review its configuration." }); }).finally(() => { reconciling = false; });
  }, 3000);
  reconcile.unref();
  return {
    listener: (request, response) => { void listener(request, response); },
    async close() {
      clearInterval(reconcile);
      // Let in-flight coordinated writes finish before the endpoint goes away.
      await drainCoordinatedWork();
      clearRuntimeSnapshot();
      operationEvents.off("change", notify);
      for (const client of clients) client.end();
      clients.clear();
    }
  };
}

/** Attach the management API to an instance guard the caller already holds (the daemon). */
export function attachManagementApi(guard: InstanceGuard): ManagementApi {
  const api = createManagementApi();
  guard.setRequestListener(api.listener);
  return {
    listener: api.listener,
    async close() {
      guard.setRequestListener(null);
      await api.close();
    }
  };
}

/**
 * Hold the control endpoint in this process and serve only the management API
 * (no gateway). Throws DaemonAlreadyRunningError ("already running") when a
 * daemon or another control service holds it.
 */
export async function startControlServer(): Promise<() => Promise<void>> {
  const guard = await acquireInstanceGuard(getControlEndpoint());
  const api = attachManagementApi(guard);
  return async () => {
    await api.close();
    await guard.close();
  };
}

export function controlRequest<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    // JSON arrays turn undefined into null; omit absent optional arguments.
    const supplied = [...args];
    while (supplied.length && supplied.at(-1) === undefined) supplied.pop();
    const body = JSON.stringify({ version: CONTROL_VERSION, method, args: supplied });
    const request = http.request({ ...controlConnectOptions(), path: "/v1/command", method: "POST", headers: { authorization: `Bearer ${controlKey()}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, response => {
      let data = "";
      response.on("data", chunk => { data += chunk; });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (response.statusCode !== 200) {
            // A daemon that has not attached the management API yet is still starting.
            const error = new Error(parsed.error ?? "Management request failed") as NodeJS.ErrnoException;
            if (response.statusCode === 404 || response.statusCode === 503) error.code = "ECONNREFUSED";
            reject(error);
          } else resolve(parsed.result);
        } catch { reject(new Error("Invalid management response")); }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

const UNREACHABLE = ["ENOENT", "ECONNREFUSED", "ECONNRESET", "FailedToOpenSocket"];

/** Make sure a daemon (and so the management API) is serving, starting it when needed. */
export async function ensureControlService(cliPath: string): Promise<void> {
  try { await controlRequest("snapshot"); return; } catch (error) {
    if (!UNREACHABLE.includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
  const { startDaemon } = await import("./daemon.js");
  await startDaemon(loadConfig(), cliPath, new SecretsManager());
  for (let attempt = 0; attempt < 50; attempt++) { try { await controlRequest("snapshot"); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  throw new Error("mcpx control service did not become ready");
}

export function subscribeControlEvents(listener: (event: { type: string; operation?: Operation }) => void, onError?: (error: Error) => void): () => void {
  let closed = false;
  const request = http.get({ ...controlConnectOptions(), path: "/v1/events", headers: { authorization: `Bearer ${controlKey()}` } }, response => {
    response.on("end", () => { if (!closed) onError?.(new Error("Local service disconnected")); });
    let pending = "";
    response.on("data", chunk => {
      pending += chunk;
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        if (event.startsWith("data: ")) { try { listener(JSON.parse(event.slice(6))); } catch { /* isolate subscriber errors */ } }
      }
    });
  });
  request.on("error", error => { if (!closed) onError?.(error); });
  return () => { closed = true; request.destroy(); };
}
