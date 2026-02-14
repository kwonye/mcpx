export type ClientId = "claude" | "codex" | "cursor" | "cline" | "vscode";

export interface HttpServerSpec {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface StdioServerSpec {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type UpstreamServerSpec = HttpServerSpec | StdioServerSpec;

export interface GatewayConfig {
  port: number;
  tokenRef: string;
  autoStart: boolean;
}

export type ClientStatus = "SYNCED" | "UNSUPPORTED_HTTP" | "ERROR" | "SKIPPED";

export interface ClientSyncState {
  status: ClientStatus;
  lastSyncAt?: string;
  message?: string;
  configPath?: string;
}

export interface McpxConfig {
  schemaVersion: 1;
  gateway: GatewayConfig;
  servers: Record<string, UpstreamServerSpec>;
  clients: Partial<Record<ClientId, ClientSyncState>>;
}

export interface ManagedEntry {
  fingerprint: string;
  lastSyncedAt: string;
}

export interface ManagedClientState {
  configPath: string;
  entries: Record<string, ManagedEntry>;
}

export interface ManagedIndex {
  schemaVersion: 1;
  managed: Record<string, ManagedClientState>;
}

export interface SyncResult {
  clientId: ClientId;
  status: ClientStatus;
  configPath?: string;
  message?: string;
}

export interface ClientAdapter {
  id: ClientId;
  detectConfigPath(): string | null;
  supportsHttp(): boolean;
  syncGateway(config: McpxConfig, options: SyncClientOptions): SyncResult;
}

export interface SyncClientOptions {
  managedEntries: ManagedGatewayEntry[];
  managedIndex: ManagedIndex;
  managedIndexPath: string;
}

export interface ManagedGatewayEntry {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface UpstreamServerRuntime {
  name: string;
  spec: UpstreamServerSpec;
}
