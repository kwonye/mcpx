// Daemon identity: the runtime record, the local control endpoint (single-
// instance guard + newline-delimited JSON control channel) and its clients.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { getControlEndpoint, getRuntimeRecordPath } from "../core/paths.js";
import { writeJsonAtomic } from "../util/fs.js";

export const RuntimeRecordSchema = z.object({
  schema: z.literal(1),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  version: z.string(),
  startedAt: z.string(),
  instanceId: z.string().min(8),
  endpoint: z.string(),
  supervised: z.boolean().optional()
});
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>;

export const PingResponseSchema = z.object({
  ok: z.literal(true),
  pid: z.number().int().positive(),
  ready: z.boolean(),
  version: z.string(),
  instanceId: z.string(),
  startedAt: z.string(),
  port: z.number().int().optional(),
  supervised: z.boolean().optional()
});
export type DaemonPing = z.infer<typeof PingResponseSchema>;

const ControlRequestSchema = z.object({
  op: z.enum(["ping", "shutdown"]),
  instanceId: z.string().optional()
});
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export function readRuntimeRecord(recordPath = getRuntimeRecordPath()): RuntimeRecord | null {
  try {
    const parsed = RuntimeRecordSchema.safeParse(JSON.parse(fs.readFileSync(recordPath, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeRuntimeRecord(record: RuntimeRecord, recordPath = getRuntimeRecordPath()): void {
  writeJsonAtomic(recordPath, RuntimeRecordSchema.parse(record));
}

/** Removes the record only if it still belongs to `instanceId` (or unconditionally when omitted). */
export function removeRuntimeRecord(instanceId?: string, recordPath = getRuntimeRecordPath()): void {
  if (instanceId) {
    const current = readRuntimeRecord(recordPath);
    if (current && current.instanceId !== instanceId) return;
  }
  try {
    fs.unlinkSync(recordPath);
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------
// Raw exchange: connect, write a payload, read a line (or until close).

type ExchangeTarget = { path: string } | { port: number };
type ExchangeResult = { ok: true; data: string } | { ok: false; error: string };

export function rawExchange(target: ExchangeTarget, payload: string, options: { line: boolean; timeoutMs: number }): Promise<ExchangeResult> {
  return new Promise((resolve) => {
    let buffer = "";
    let finished = false;
    const socket = "path" in target ? net.connect(target.path) : net.connect(target.port, "127.0.0.1");
    const finish = (result: ExchangeResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), options.timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (options.line && buffer.includes("\n")) finish({ ok: true, data: buffer });
    });
    socket.on("end", () => finish({ ok: true, data: buffer }));
    socket.on("close", () => finish({ ok: true, data: buffer }));
    socket.on("error", (error: NodeJS.ErrnoException) => finish({ ok: false, error: error.code ?? error.message }));
  });
}

// Same exchange in a short-lived child, for the synchronous compatibility API
// (stopDaemon() is synchronous and cannot await a socket). Self-contained JS.
const SYNC_EXCHANGE_SCRIPT = `
const net = require("net");
const target = JSON.parse(process.env.MCPX_EXCHANGE_TARGET);
const line = process.env.MCPX_EXCHANGE_LINE === "1";
let buffer = "", finished = false;
const socket = target.path ? net.connect(target.path) : net.connect(target.port, "127.0.0.1");
function finish(result) {
  if (finished) return;
  finished = true;
  process.stdout.write(JSON.stringify(result));
  socket.destroy();
  process.exit(0);
}
setTimeout(() => finish({ ok: false, error: "timeout" }), Number(process.env.MCPX_EXCHANGE_TIMEOUT || 1500));
socket.setEncoding("utf8");
socket.on("connect", () => socket.write(process.env.MCPX_EXCHANGE_PAYLOAD));
socket.on("data", (chunk) => { buffer += chunk; if (line && buffer.includes("\\n")) finish({ ok: true, data: buffer }); });
socket.on("end", () => finish({ ok: true, data: buffer }));
socket.on("close", () => finish({ ok: true, data: buffer }));
socket.on("error", (error) => finish({ ok: false, error: error.code || String(error) }));
`;

const ExchangeResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);

export function rawExchangeSync(target: ExchangeTarget, payload: string, options: { line: boolean; timeoutMs: number }): ExchangeResult {
  const result = spawnSync(process.execPath, ["-e", SYNC_EXCHANGE_SCRIPT], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs + 5000,
    env: {
      ...process.env,
      ...(typeof process.versions.electron === "string" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      MCPX_EXCHANGE_TARGET: JSON.stringify(target),
      MCPX_EXCHANGE_PAYLOAD: payload,
      MCPX_EXCHANGE_LINE: options.line ? "1" : "0",
      MCPX_EXCHANGE_TIMEOUT: String(options.timeoutMs)
    }
  });
  try {
    const parsed = ExchangeResultSchema.safeParse(JSON.parse(result.stdout ?? ""));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through.
  }
  return { ok: false, error: result.error?.message ?? "exchange helper failed" };
}

// ---------------------------------------------------------------------------
// Control client.

function parsePing(result: ExchangeResult): DaemonPing | null {
  if (!result.ok) return null;
  const line = result.data.split("\n")[0] ?? "";
  try {
    const parsed = PingResponseSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function controlPayload(request: ControlRequest): string {
  return `${JSON.stringify(request)}\n`;
}

/** Asks whoever holds this user's control endpoint who it is. Null when nobody answers. */
export async function pingDaemon(endpoint = getControlEndpoint(), timeoutMs = 1500): Promise<DaemonPing | null> {
  return parsePing(await rawExchange({ path: endpoint }, controlPayload({ op: "ping" }), { line: true, timeoutMs }));
}

export function pingDaemonSync(endpoint = getControlEndpoint(), timeoutMs = 1500): DaemonPing | null {
  if (process.platform !== "win32" && !fs.existsSync(endpoint)) return null;
  return parsePing(rawExchangeSync({ path: endpoint }, controlPayload({ op: "ping" }), { line: true, timeoutMs }));
}

export async function requestShutdown(instanceId: string, endpoint = getControlEndpoint(), timeoutMs = 2000): Promise<boolean> {
  const result = await rawExchange({ path: endpoint }, controlPayload({ op: "shutdown", instanceId }), { line: true, timeoutMs });
  return result.ok && result.data.includes("\"ok\":true");
}

export function requestShutdownSync(instanceId: string, endpoint = getControlEndpoint(), timeoutMs = 2000): boolean {
  const result = rawExchangeSync({ path: endpoint }, controlPayload({ op: "shutdown", instanceId }), { line: true, timeoutMs });
  return result.ok && result.data.includes("\"ok\":true");
}

/** Whether anything accepts connections on the endpoint (a live daemon, possibly still starting). */
export async function endpointIsLive(endpoint = getControlEndpoint(), timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(endpoint);
    const done = (live: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(live);
    };
    // A connect that hangs means something holds the endpoint: treat as live.
    const timer = setTimeout(() => done(true), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

// Legacy (pid-file era) daemons have no control endpoint; recognise them by
// the gateway's unauthenticated /health fingerprint on the recorded port.
function isMcpxHealthResponse(result: ExchangeResult): boolean {
  if (!result.ok) return false;
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(result.data)?.[1];
  const body = result.data.slice(result.data.indexOf("\r\n\r\n") + 4);
  return (status === "401" && body.includes("\"unauthorized\"")) || (status === "200" && body.includes("\"server\":\"mcpx\""));
}

const HEALTH_REQUEST = "GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";

export async function looksLikeMcpxGateway(port: number, timeoutMs = 1500): Promise<boolean> {
  return isMcpxHealthResponse(await rawExchange({ port }, HEALTH_REQUEST, { line: false, timeoutMs }));
}

export function looksLikeMcpxGatewaySync(port: number, timeoutMs = 1500): boolean {
  return isMcpxHealthResponse(rawExchangeSync({ port }, HEALTH_REQUEST, { line: false, timeoutMs }));
}

// ---------------------------------------------------------------------------
// Server side: the instance guard.

export class DaemonAlreadyRunningError extends Error {
  constructor(readonly endpoint: string, readonly existing: DaemonPing | null) {
    super(existing
      ? `Another mcpx daemon is already running (pid ${existing.pid}, version ${existing.version}${existing.port ? `, port ${existing.port}` : ""}).`
      : "Another mcpx daemon is already running or starting for this user.");
    this.name = "DaemonAlreadyRunningError";
  }
}

export interface ControlHandlers {
  ping(): DaemonPing;
  shutdown(): void;
}

export interface InstanceGuard {
  endpoint: string;
  setHandlers(handlers: ControlHandlers): void;
  close(): Promise<void>;
}

function listenOnce(server: net.Server, endpoint: string): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resolve(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

const MAX_REQUEST_BYTES = 4096;

/**
 * Exclusively binds the per-user control endpoint for the lifetime of this
 * process. The OS releases a named pipe when the owner dies; a Unix socket
 * file outlives a killed owner, so a bind conflict is resolved by connecting:
 * a refused connection means the file is stale and is replaced (under a
 * short exclusive lock so two starting daemons cannot both replace it).
 */
export async function acquireInstanceGuard(endpoint = getControlEndpoint()): Promise<InstanceGuard> {
  let handlers: ControlHandlers | null = null;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let request: ControlRequest;
      try {
        request = ControlRequestSchema.parse(JSON.parse(line));
      } catch {
        socket.end(`${JSON.stringify({ ok: false, error: "bad_request" })}\n`);
        return;
      }
      if (!handlers) {
        socket.end(`${JSON.stringify({ ok: false, error: "starting" })}\n`);
        return;
      }
      if (request.op === "ping") {
        socket.end(`${JSON.stringify(handlers.ping())}\n`);
        return;
      }
      const current = handlers.ping();
      if (request.instanceId && request.instanceId !== current.instanceId) {
        socket.end(`${JSON.stringify({ ok: false, error: "instance_mismatch" })}\n`);
        return;
      }
      const shutdown = handlers.shutdown;
      socket.end(`${JSON.stringify({ ok: true, pid: process.pid })}\n`, () => shutdown());
    });
  });

  const isPosix = process.platform !== "win32";
  if (isPosix) {
    fs.mkdirSync(path.dirname(endpoint), { recursive: true, mode: 0o700 });
  }

  let error = await listenOnce(server, endpoint);
  if (error?.code === "EADDRINUSE" && isPosix && !(await endpointIsLive(endpoint))) {
    const lockPath = `${endpoint}.lock`;
    let lockFd: number | null = null;
    try {
      lockFd = fs.openSync(lockPath, "wx", 0o600);
    } catch {
      // Someone else is recovering; a lock older than 10s is abandoned.
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10_000) {
          fs.unlinkSync(lockPath);
          lockFd = fs.openSync(lockPath, "wx", 0o600);
        }
      } catch {
        lockFd = null;
      }
    }
    if (lockFd !== null) {
      try {
        // Re-check under the lock: another daemon may have won meanwhile.
        if (!(await endpointIsLive(endpoint))) {
          try { fs.unlinkSync(endpoint); } catch { /* already gone */ }
          error = await listenOnce(server, endpoint);
        }
      } finally {
        fs.closeSync(lockFd);
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }
  }

  if (error) {
    server.close();
    if (error.code === "EADDRINUSE") {
      throw new DaemonAlreadyRunningError(endpoint, await pingDaemon(endpoint).catch(() => null));
    }
    throw error;
  }

  let ownInode: number | null = null;
  if (isPosix) {
    try {
      fs.chmodSync(endpoint, 0o600);
      ownInode = fs.statSync(endpoint).ino;
    } catch {
      // Best effort; the runtime dir is 0700.
    }
  }

  return {
    endpoint,
    setHandlers(next) {
      handlers = next;
    },
    close() {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          // Some runtimes leave the socket file behind; remove it only if it is still ours.
          if (isPosix && ownInode !== null) {
            try {
              if (fs.statSync(endpoint).ino === ownInode) fs.unlinkSync(endpoint);
            } catch {
              // Already removed.
            }
          }
          resolve();
        });
      });
    }
  };
}
