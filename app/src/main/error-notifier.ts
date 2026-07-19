import { Notification } from "electron";
import { loadConfig, getDaemonStatus, SecretsManager, ensureGatewayToken } from "@mcpx/core";
import { describeTokenError } from "../shared/token-error";
import { GATEWAY_FETCH_TIMEOUT_MS } from "../shared/timeouts";
import { loadDesktopSettings } from "./settings-store";
import { openDashboard } from "./dashboard";

export type ErrorKind = "call" | "reauth";

export interface TokenCountEntry {
  total: number;
  error?: string;
  runtimeError?: string;
}

export interface NotificationItem {
  server: string;
  kind: ErrorKind;
  title: string;
  body: string;
}

export interface ComputeResult {
  toNotify: NotificationItem[];
  nextNotified: Map<string, ErrorKind>;
}

const CHECK_INTERVAL_MS = 45_000;

function deriveKind(count: TokenCountEntry): ErrorKind | null {
  // Prefer structured codes when available
  if (count.runtimeErrorCode) {
    return "call";
  }
  if (count.errorCode === "auth_expired" || count.errorCode === "auth_required") {
    return "reauth";
  }
  if (count.runtimeError) {
    return "call";
  }
  if (count.error && describeTokenError(count.error).authLike) {
    return "reauth";
  }
  return null;
}

function buildItem(server: string, kind: ErrorKind, count: TokenCountEntry): NotificationItem {
  if (kind === "call") {
    return {
      server,
      kind,
      title: `${server}: tool calls are failing`,
      body: count.runtimeError ?? ""
    };
  }
  return {
    server,
    kind,
    title: `${server} needs re-authentication`,
    body: "Sign-in expired — open mcpx to re-authenticate."
  };
}

/**
 * Pure, edge-triggered computation of which servers need a fresh notification.
 * Emits only when a server's error kind is new or changed vs. `lastNotified`.
 * When a server recovers (no error), it is removed from the map so a later
 * re-failure notifies again.
 */
export function computeErrorNotifications(
  counts: Record<string, TokenCountEntry>,
  lastNotified: Map<string, ErrorKind>
): ComputeResult {
  const nextNotified = new Map(lastNotified);
  const toNotify: NotificationItem[] = [];

  for (const [server, count] of Object.entries(counts)) {
    const kind = deriveKind(count);
    const prev = nextNotified.get(server);

    if (kind === null) {
      nextNotified.delete(server);
      continue;
    }

    if (prev !== kind) {
      toNotify.push(buildItem(server, kind, count));
      nextNotified.set(server, kind);
    }
  }

  // Clear servers no longer present so a re-added server notifies fresh.
  const stale: string[] = [];
  for (const server of nextNotified.keys()) {
    if (!(server in counts)) {
      stale.push(server);
    }
  }
  for (const server of stale) {
    nextNotified.delete(server);
  }

  return { toNotify, nextNotified };
}

let interval: ReturnType<typeof setInterval> | null = null;
let lastNotified: Map<string, ErrorKind> = new Map();

async function pollOnce(): Promise<void> {
  if (!loadDesktopSettings().errorNotificationsEnabled) {
    return;
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return;
  }
  if (!getDaemonStatus(config).running) {
    return;
  }

  const secrets = new SecretsManager();
  const token = ensureGatewayToken(config, secrets);
  if (!token) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${config.gateway.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "error-notifier",
        method: "custom/tokenCounts",
        params: {}
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { result?: Record<string, TokenCountEntry> };
    const counts = data?.result ?? {};

    const { toNotify, nextNotified: updated } = computeErrorNotifications(counts, lastNotified);
    lastNotified = updated;

    for (const item of toNotify) {
      const notification = new Notification({ title: item.title, body: item.body });
      notification.on("click", () => openDashboard());
      notification.show();
    }
  } catch {
    // Best-effort polling; ignore network/parse failures.
  } finally {
    clearTimeout(timeout);
  }
}

export function startErrorNotifier(): void {
  if (!Notification.isSupported()) {
    return;
  }
  if (interval) {
    return;
  }
  interval = setInterval(() => {
    void pollOnce();
  }, CHECK_INTERVAL_MS);
}

export function disposeErrorNotifier(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  lastNotified = new Map();
}
