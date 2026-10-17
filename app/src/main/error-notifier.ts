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
  errorCode?: string;
  runtimeErrorCode?: string;
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

const AUTH_ERROR_CODES = new Set(["auth_expired", "auth_required"]);

function deriveKind(count: TokenCountEntry): ErrorKind | null {
  // Structured codes are checked first, and only the code (never the raw
  // message string) decides "reauth" at runtime -- a stdio server can fail a
  // tool call for its own internal auth reasons (e.g. "Run `railway login`
  // first") without that being an mcpx-managed OAuth/token problem, and
  // sending the user to mcpx to "re-authenticate" would be a dead end. Only a
  // runtimeErrorCode/errorCode that mcpx itself classified as auth_expired or
  // auth_required means mcpx's own credential is the problem.
  if (count.runtimeErrorCode && AUTH_ERROR_CODES.has(count.runtimeErrorCode)) {
    return "reauth";
  }
  if (count.errorCode && AUTH_ERROR_CODES.has(count.errorCode)) {
    return "reauth";
  }
  if (count.runtimeErrorCode || count.runtimeError) {
    return "call";
  }
  if (count.error && describeTokenError(count.error, count.errorCode).authLike) {
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
    const res = await fetch(`http://127.0.0.1:${config.gateway.port}/internal/token-counts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { counts?: Record<string, TokenCountEntry> };
    const counts = data?.counts ?? {};

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
