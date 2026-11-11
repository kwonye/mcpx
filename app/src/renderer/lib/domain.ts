/**
 * The one vocabulary for states shown in the UI. Every screen (dashboard,
 * popover, project overrides) derives labels from here so "Connected",
 * "Needs sign-in", "Error" and "Off" always mean the same thing.
 */
import type { StatusServerEntry } from "@mcpx/core";
import type { Tone } from "../components/ui/Badge";
import type { TokenCount } from "../../shared/ipc-contract";
import { describeTokenError } from "../../shared/token-error";

export type ServerStateKind = "connected" | "needs-sign-in" | "error" | "off" | "checking" | "waiting" | "gateway-stopped";

export interface ServerState {
  kind: ServerStateKind;
  label: string;
  tone: Tone;
  /** One plain sentence explaining the state, when there is more to say. */
  detail?: string;
  /** Whether the state is resolved by signing in. */
  signIn: boolean;
}

export interface ServerStateInput {
  enabled: boolean;
  tokenCount?: TokenCount;
  pendingSignIn: boolean;
  gatewayRunning: boolean;
  countsLoading: boolean;
}

export function deriveServerState({ enabled, tokenCount, pendingSignIn, gatewayRunning, countsLoading }: ServerStateInput): ServerState {
  if (!enabled) return { kind: "off", label: "Off", tone: "neutral", signIn: false };
  if (pendingSignIn) {
    return { kind: "needs-sign-in", label: "Needs sign-in", tone: "warning", detail: "This server needs you to sign in before your apps can use it.", signIn: true };
  }
  const failure = tokenCount?.error
    ? { message: tokenCount.error, code: tokenCount.errorCode }
    : tokenCount?.runtimeError
      ? { message: tokenCount.runtimeError, code: tokenCount.runtimeErrorCode }
      : null;
  if (failure) {
    const { label, authLike } = describeTokenError(failure.message, failure.code);
    if (authLike) {
      return { kind: "needs-sign-in", label: "Needs sign-in", tone: "warning", detail: `${label}. Sign in again to reconnect.`, signIn: true };
    }
    return { kind: "error", label: "Error", tone: "danger", detail: label === "token error" ? failure.message : `${label}: ${failure.message}`, signIn: false };
  }
  if (tokenCount) return { kind: "connected", label: "Connected", tone: "success", signIn: false };
  if (!gatewayRunning) return { kind: "gateway-stopped", label: "Gateway stopped", tone: "neutral", detail: "Start the gateway to connect this server.", signIn: false };
  if (countsLoading) return { kind: "checking", label: "Checking", tone: "neutral", signIn: false };
  return { kind: "waiting", label: "Not checked yet", tone: "neutral", signIn: false };
}

export const SERVER_STATE_ORDER: Record<ServerStateKind, number> = {
  "needs-sign-in": 0,
  error: 1,
  connected: 2,
  checking: 3,
  waiting: 3,
  "gateway-stopped": 3,
  off: 4
};

export function needsAttention(state: ServerState): boolean {
  return state.kind === "needs-sign-in" || state.kind === "error";
}

/** Human names for every client mcpx can manage. Unknown ids fall back to a title-cased id. */
export const CLIENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  cline: "Cline",
  opencode: "OpenCode",
  kiro: "Kiro",
  vscode: "VS Code",
  qwen: "Qwen Code",
  openclaw: "OpenClaw",
  hermes: "Hermes"
};

export function clientName(clientId: string): string {
  return CLIENT_NAMES[clientId] ?? titleCase(clientId);
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export interface ClientState {
  label: string;
  tone: Tone;
  managed: boolean;
  detail?: string;
}

export function deriveClientState(state: { status?: string; message?: string } | undefined): ClientState {
  if (!state?.status) {
    return { label: "Not set up", tone: "neutral", managed: false, detail: "mcpx hasn't synced this app yet. Use Sync now to set it up." };
  }
  switch (state.status) {
    case "SYNCED":
      return { label: "Synced", tone: "success", managed: true };
    case "ERROR":
      return { label: "Sync failed", tone: "danger", managed: true, detail: state.message || "The last sync didn't finish." };
    case "UNSUPPORTED_HTTP":
      return { label: "Not supported", tone: "warning", managed: false, detail: state.message || "This app can't connect to URL-based servers, so mcpx can't manage it." };
    case "SKIPPED":
      return { label: "Not installed", tone: "neutral", managed: false, detail: state.message || "mcpx didn't find this app on this computer." };
    default:
      return { label: titleCase(state.status), tone: "neutral", managed: false, detail: state.message };
  }
}

/** Human transport description: "URL" servers vs "Local command" servers. */
export function transportLabel(transport: string): string {
  return transport === "http" ? "Remote URL" : transport === "stdio" ? "Local command" : titleCase(transport);
}

export function isOAuthServer(server: Pick<StatusServerEntry, "authBindings">): boolean {
  return server.authBindings.some((binding) => binding.value.startsWith("oauth://"));
}

/** Clients this server is currently written into. */
export function syncedClients(server: Pick<StatusServerEntry, "clients">): string[] {
  return server.clients.filter((client) => client.managed && client.status === "SYNCED").map((client) => clientName(client.clientId));
}
