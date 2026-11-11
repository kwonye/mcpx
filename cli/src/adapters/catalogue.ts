import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ClientId, ManagedGatewayEntry, PluginComponent, SyncClientOptions, UpstreamServerSpec } from "../types.js";
import { localCliCommand } from "../core/runtime-entry.js";
import {
  appDataDir,
  homePath,
  joinPath,
  localAppDataDir,
  macApps,
  windowsPrograms,
  xdgConfigDir,
  type HostContext
} from "./host.js";
import { purgeManagedFromDisabledArray, purgeManagedFromExcludedArray } from "./utils/index.js";

type JsonObject = Record<string, unknown>;

export type ConfigFormat = "json" | "toml" | "yaml";

const stringMapSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : value),
  z.record(z.string(), z.string())
);

/** Union of every field any client uses for an MCP server entry. */
export const rawEntrySchema = z.object({
  type: z.string().optional(),
  transportType: z.string().optional(),
  url: z.string().min(1).optional(),
  httpUrl: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  http_headers: stringMapSchema.optional(),
  command: z.union([z.string().min(1), z.array(z.string())]).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  environment: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  disabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
  auth: z.unknown().optional()
}).passthrough();

export type RawEntry = z.infer<typeof rawEntrySchema>;

export const TRANSPORT_SKIP_REASON = "Entry must define exactly one transport that mcpx supports.";

/** Data + hooks describing one client. Everything else is handled by the generic adapter. */
export interface ClientDefinition {
  id: ClientId;
  displayName: string;
  format: ConfigFormat;
  /** Candidate config files, in priority order: the first that exists is used, otherwise the first. */
  configPaths(ctx: HostContext): string[];
  /** Key path of the server map inside the config document. */
  container: string[];
  /** Directories/app bundles/install dirs whose existence means the client is installed (config files always count). */
  installMarkers(ctx: HostContext): string[];
  /** Executables whose presence on PATH means the client is installed. */
  binaries: string[];
  /** Native entry written for a managed gateway server. */
  toEntry(entry: ManagedGatewayEntry, ctx: HostContext): JsonObject;
  /** Write disabled servers with their enabled flag instead of omitting them. */
  keepDisabled?: boolean;
  /** Map a native entry to an mcpx spec, or return a skip reason. */
  importEntry(entry: RawEntry, disabled: boolean): UpstreamServerSpec | string;
  /** Server maps scanned for imports (defaults to the container). */
  importSources?(doc: JsonObject): JsonObject;
  /** Names the client marks disabled outside the entry itself. */
  disabledNames?(doc: JsonObject): Set<string>;
  /** Client-specific reconciliation after managed entries are merged. */
  afterMerge?(doc: JsonObject, options: SyncClientOptions, managedNames: string[]): void;
  skillsDir(ctx: HostContext): string;
  skillsLayout: "dir" | "flat";
  /** Other skill directories the client reads natively (skills there are not projected again). */
  additionalSkillDirs?(ctx: HostContext): string[];
  /** Native name for a managed server (default `<name> (mcpx)`). */
  managedName?(serverName: string): string;
  /** Refuse to sync with this message (e.g. the client's MCP support is turned off). */
  syncBlocker?(configPath: string, ctx: HostContext): string | null;
  /** Project-scoped config file, relative to a registered project root. */
  projectConfig?: string;
  /** Project-scoped skills directory, relative to a registered project root (default `.<id>/skills`). */
  projectSkills?: string;
  /** Plugin components projected into project installations. */
  pluginComponents?: PluginComponent[];
}

interface ImportRules {
  /** Accepted `type` values per transport. Omit to ignore the type field. */
  types?: { http: string[]; stdio: string[] };
  typeOf?: (entry: RawEntry) => string | undefined;
  enabled: "disabled-flag" | "enabled-flag" | "none";
}

function mapStandardEntry(entry: RawEntry, disabledElsewhere: boolean, rules: ImportRules): UpstreamServerSpec | string {
  const type = rules.types ? (rules.typeOf ?? ((e: RawEntry) => e.type))(entry) : undefined;
  const enabled = rules.enabled === "none"
    ? undefined
    : !(disabledElsewhere || (rules.enabled === "disabled-flag" ? entry.disabled === true : entry.enabled === false));

  if ((type === undefined || rules.types?.http.includes(type)) && entry.url && !entry.command) {
    return { transport: "http", url: entry.url, headers: entry.http_headers ?? entry.headers, enabled };
  }

  if ((type === undefined || rules.types?.stdio.includes(type)) && entry.command && !entry.url) {
    const parts = Array.isArray(entry.command) ? entry.command : [entry.command, ...(entry.args ?? [])];
    if (parts.length === 0 || !parts[0]) return "Entry could not be mapped to an mcpx server.";
    return {
      transport: "stdio",
      command: parts[0],
      args: Array.isArray(entry.command) ? parts.slice(1) : entry.args,
      env: entry.environment ?? entry.env,
      cwd: entry.workingDirectory ?? entry.cwd,
      enabled
    };
  }

  return TRANSPORT_SKIP_REASON;
}

const STANDARD_TYPES = { http: ["http", "streamable-http"], stdio: ["stdio"] };

function standardImport(entry: RawEntry, disabled: boolean): UpstreamServerSpec | string {
  if (Array.isArray(entry.command)) return "Entry could not be mapped to an mcpx server.";
  return mapStandardEntry(entry, disabled, { types: STANDARD_TYPES, enabled: "disabled-flag" });
}

function oauthAware(rules: ImportRules) {
  return (entry: RawEntry, disabled: boolean): UpstreamServerSpec | string => {
    if (entry.auth === "oauth") return "OAuth-authenticated servers cannot be imported via mcpx.";
    if (Array.isArray(entry.command)) return "Entry could not be mapped to an mcpx server.";
    return mapStandardEntry(entry, disabled, rules);
  };
}

function httpEntry(type: string | undefined, urlKey = "url") {
  return (entry: ManagedGatewayEntry): JsonObject => ({
    ...(type ? { type } : {}),
    [urlKey]: entry.url,
    headers: entry.headers
  });
}

// Claude Desktop's claude_desktop_config.json only supports stdio servers, so mcpx
// installs a stdio bridge (`mcpx proxy <name>`) per managed server. The bridge runs
// this installation's CLI runtime and authenticates as the client's consumer token.
// See https://modelcontextprotocol.io/quickstart/user
function proxyBridgeEntry(entry: ManagedGatewayEntry): JsonObject {
  const upstreamName = entry.name.replace(/ \(mcpx\)$/, "");
  const cli = localCliCommand(["proxy", upstreamName]);
  const proxyToken = /^Bearer\s+(.+)$/i.exec(entry.headers.Authorization ?? "")?.[1];
  return {
    command: cli.command,
    args: cli.args,
    env: {
      ...cli.env,
      ...(cli.args[0] ? { MCPX_CLI_ENTRY: cli.args[0] } : {}),
      ...(proxyToken ? { MCPX_PROXY_TOKEN: proxyToken } : {})
    }
  };
}

// Pi only allows letters, digits, '_' and '-' in MCP server names.
function piManagedName(name: string): string {
  return `${name.replace(/[^A-Za-z0-9_-]/g, "_")}__mcpx`;
}

function piSyncBlocker(configPath: string): string | null {
  const settingsPath = path.join(path.dirname(configPath), "settings.json");
  try {
    if (!fs.existsSync(settingsPath)) return null;
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { extensions?: unknown };
    if (Array.isArray(settings.extensions) && settings.extensions.includes("-builtin:mcp")) {
      return "Pi built-in MCP is disabled. Enable it before syncing.";
    }
  } catch {
    return `Pi settings at ${settingsPath} could not be parsed; refusing to sync.`;
  }
  return null;
}

function normalizeProjectKey(projectPath: string): string {
  try {
    return fs.realpathSync(path.resolve(projectPath));
  } catch {
    return path.resolve(projectPath);
  }
}

function syncProjectDisabledArray(project: JsonObject, managedNames: string[], disabledForProject: string[]): void {
  const existingNonManaged = ((project.disabledMcpServers as string[] | undefined) ?? [])
    .filter((name) => !managedNames.includes(name));
  const combined = [...existingNonManaged, ...disabledForProject];
  if (combined.length > 0) {
    project.disabledMcpServers = combined;
  } else {
    delete project.disabledMcpServers;
  }
}

/**
 * Claude Code scopes disabled servers per project via `projects[path].disabledMcpServers`.
 * Reconcile every existing project entry against the registered mcpx project scopes and
 * create entries for registered scopes Claude has not seen yet (only when non-empty).
 */
function reconcileClaudeProjects(doc: JsonObject, options: SyncClientOptions, managedNames: string[]): void {
  purgeManagedFromDisabledArray(doc, managedNames);

  const scopeByPath = new Map<string, string[]>();
  for (const scope of options.projectScopes ?? []) {
    scopeByPath.set(normalizeProjectKey(scope.path), scope.disabledServerNames);
  }

  const projects = (doc.projects as Record<string, JsonObject> | undefined) ?? {};
  for (const projectPath of Object.keys(projects)) {
    const project = projects[projectPath] ?? {};
    syncProjectDisabledArray(project, managedNames, scopeByPath.get(normalizeProjectKey(projectPath)) ?? []);
    projects[projectPath] = project;
  }

  for (const scope of options.projectScopes ?? []) {
    if (scope.disabledServerNames.length === 0) continue;
    const key = normalizeProjectKey(scope.path);
    if (!Object.keys(projects).some((p) => normalizeProjectKey(p) === key)) {
      projects[scope.path] = { disabledMcpServers: [...scope.disabledServerNames] };
    }
  }
  doc.projects = projects;
}

function claudeDisabledNames(doc: JsonObject): Set<string> {
  const names = new Set((doc.disabledMcpServers as string[] | undefined) ?? []);
  for (const project of Object.values((doc.projects as Record<string, JsonObject> | undefined) ?? {})) {
    for (const name of (project?.disabledMcpServers as string[] | undefined) ?? []) {
      names.add(name);
    }
  }
  return names;
}

function vscodeFamily(id: "vscode" | "vscode-insiders", displayName: string, dataDir: string, macBundle: string, winDir: string, binary: string): ClientDefinition {
  return {
    id,
    displayName,
    format: "json",
    configPaths: (ctx) => [joinPath(ctx, appDataDir(ctx), dataDir, "User", "mcp.json")],
    container: ["servers"],
    installMarkers: (ctx) => [
      joinPath(ctx, appDataDir(ctx), dataDir),
      ...macApps(ctx, macBundle),
      ...windowsPrograms(ctx, winDir)
    ],
    binaries: [binary],
    toEntry: httpEntry("http"),
    importEntry: standardImport,
    skillsDir: (ctx) => homePath(ctx, ".copilot", "skills"),
    skillsLayout: "dir",
    // Stable and Insiders share a workspace's .vscode/mcp.json; only one installation owns it.
    ...(id === "vscode" ? { projectConfig: ".vscode/mcp.json", projectSkills: ".github/skills" } : {}),
    pluginComponents: ["skills"]
  };
}

const CLINE_SETTINGS = ["saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"];

export const CLIENT_CATALOGUE: ClientDefinition[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    format: "json",
    configPaths: (ctx) => [homePath(ctx, ".claude.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => [homePath(ctx, ".claude")],
    binaries: ["claude"],
    toEntry: httpEntry("http"),
    importEntry: standardImport,
    disabledNames: claudeDisabledNames,
    afterMerge: reconcileClaudeProjects,
    skillsDir: (ctx) => homePath(ctx, ".claude", "skills"),
    skillsLayout: "dir",
    projectConfig: ".mcp.json",
    projectSkills: ".claude/skills",
    pluginComponents: ["skills"]
  },
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    format: "json",
    configPaths: (ctx) => [joinPath(ctx, appDataDir(ctx), "Claude", "claude_desktop_config.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => {
      const local = localAppDataDir(ctx);
      return [
        joinPath(ctx, appDataDir(ctx), "Claude"),
        ...macApps(ctx, "Claude.app"),
        ...(local ? [joinPath(ctx, local, "AnthropicClaude")] : [])
      ];
    },
    binaries: [],
    toEntry: proxyBridgeEntry,
    importEntry: standardImport,
    skillsDir: (ctx) => joinPath(ctx, appDataDir(ctx), "Claude", "skills"),
    skillsLayout: "dir"
  },
  {
    id: "codex",
    displayName: "Codex",
    format: "toml",
    configPaths: (ctx) => [homePath(ctx, ".codex", "config.toml")],
    container: ["mcp_servers"],
    installMarkers: (ctx) => [homePath(ctx, ".codex"), ...macApps(ctx, "Codex.app")],
    binaries: ["codex"],
    // Codex has no `type` field: `command` means stdio, `url` means streamable HTTP.
    // https://developers.openai.com/codex/config-reference
    toEntry: (entry) => ({ url: entry.url, http_headers: entry.headers }),
    importEntry: (entry, disabled) => Array.isArray(entry.command)
      ? "Entry could not be mapped to an mcpx server."
      : mapStandardEntry(entry, disabled, { enabled: "enabled-flag" }),
    // Codex reads the shared Agent Skills location; ~/.codex/skills is its legacy one.
    skillsDir: (ctx) => homePath(ctx, ".agents", "skills"),
    skillsLayout: "dir",
    additionalSkillDirs: (ctx) => [homePath(ctx, ".codex", "skills")],
    projectConfig: ".codex/config.toml",
    projectSkills: ".agents/skills",
    pluginComponents: ["skills"]
  },
  {
    id: "cursor",
    displayName: "Cursor",
    format: "json",
    // https://cursor.com/docs/mcp
    configPaths: (ctx) => [homePath(ctx, ".cursor", "mcp.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => [
      homePath(ctx, ".cursor"),
      joinPath(ctx, appDataDir(ctx), "Cursor"),
      ...macApps(ctx, "Cursor.app"),
      ...windowsPrograms(ctx, "cursor")
    ],
    binaries: ["cursor"],
    toEntry: httpEntry("http"),
    importEntry: standardImport,
    skillsDir: (ctx) => homePath(ctx, ".cursor", "skills"),
    skillsLayout: "dir",
    projectConfig: ".cursor/mcp.json",
    pluginComponents: ["skills"]
  },
  {
    id: "cline",
    displayName: "Cline",
    format: "json",
    // ~/.cline/data/settings is the current shared location (https://docs.cline.bot/cli/configuration);
    // the others are older CLI / IDE-extension globalStorage locations still honoured when present.
    configPaths: (ctx) => [
      homePath(ctx, ".cline", "data", "settings", "cline_mcp_settings.json"),
      homePath(ctx, ".cline", "settings", "cline_mcp_settings.json"),
      joinPath(ctx, appDataDir(ctx), "Code", "User", "globalStorage", ...CLINE_SETTINGS),
      joinPath(ctx, appDataDir(ctx), "Cursor", "User", "globalStorage", ...CLINE_SETTINGS)
    ],
    container: ["mcpServers"],
    installMarkers: (ctx) => [
      homePath(ctx, ".cline"),
      joinPath(ctx, appDataDir(ctx), "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
      joinPath(ctx, appDataDir(ctx), "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev")
    ],
    binaries: ["cline"],
    toEntry: httpEntry("streamableHttp"),
    importEntry: (entry, disabled) => Array.isArray(entry.command)
      ? "Entry could not be mapped to an mcpx server."
      : mapStandardEntry(entry, disabled, {
        // Cline accepts the standard `type` field and the legacy `transportType`.
        types: { http: ["http", "streamableHttp"], stdio: ["stdio"] },
        typeOf: (e) => e.type ?? e.transportType,
        enabled: "disabled-flag"
      }),
    skillsDir: (ctx) => homePath(ctx, ".config", "cline", "skills"),
    skillsLayout: "dir",
    pluginComponents: ["skills"]
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    format: "json",
    // OpenCode resolves its global config via xdg-basedir on every OS (~/.config/opencode).
    configPaths: (ctx) => [joinPath(ctx, xdgConfigDir(ctx), "opencode", "opencode.json")],
    container: ["mcp"],
    installMarkers: (ctx) => [joinPath(ctx, xdgConfigDir(ctx), "opencode"), homePath(ctx, ".opencode")],
    binaries: ["opencode"],
    toEntry: httpEntry("remote"),
    importEntry: (entry, disabled) => mapStandardEntry(entry, disabled, {
      types: { http: ["remote", "http", "streamable-http"], stdio: ["local", "stdio"] },
      enabled: "enabled-flag"
    }),
    skillsDir: (ctx) => joinPath(ctx, xdgConfigDir(ctx), "opencode", "skills"),
    skillsLayout: "dir",
    projectConfig: "opencode.json",
    pluginComponents: []
  },
  {
    id: "kiro",
    displayName: "Kiro",
    format: "json",
    configPaths: (ctx) => [homePath(ctx, ".kiro", "settings", "mcp.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => [homePath(ctx, ".kiro"), ...macApps(ctx, "Kiro.app"), ...windowsPrograms(ctx, "Kiro")],
    binaries: ["kiro"],
    // `type` omitted so Kiro auto-detects the gateway's streamable-http transport from `url`.
    toEntry: httpEntry(undefined),
    importEntry: standardImport,
    skillsDir: (ctx) => homePath(ctx, ".kiro", "skills"),
    skillsLayout: "dir",
    pluginComponents: ["skills"]
  },
  vscodeFamily("vscode", "VS Code", "Code", "Visual Studio Code.app", "Microsoft VS Code", "code"),
  vscodeFamily("vscode-insiders", "VS Code Insiders", "Code - Insiders", "Visual Studio Code - Insiders.app", "Microsoft VS Code Insiders", "code-insiders"),
  {
    id: "qwen",
    displayName: "Qwen Code",
    format: "json",
    configPaths: (ctx) => [homePath(ctx, ".qwen", "settings.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => [homePath(ctx, ".qwen")],
    binaries: ["qwen"],
    // Qwen has no `type` field: `httpUrl` is streamable HTTP, `url` is legacy SSE.
    toEntry: httpEntry(undefined, "httpUrl"),
    importEntry: (entry, disabled) => {
      if (entry.url && !entry.httpUrl && !entry.command) {
        return "Legacy SSE transport is not supported; use Qwen's httpUrl field for MCP v2 streamable HTTP.";
      }
      if (Array.isArray(entry.command)) return "Entry could not be mapped to an mcpx server.";
      return mapStandardEntry({ ...entry, url: entry.httpUrl }, disabled, { enabled: "disabled-flag" });
    },
    // Qwen tracks disabled servers in `mcp.excluded`, not on the entry.
    disabledNames: (doc) => new Set(((doc.mcp as JsonObject | undefined)?.excluded as string[] | undefined) ?? []),
    afterMerge: (doc, _options, managedNames) => purgeManagedFromExcludedArray(doc, managedNames),
    skillsDir: (ctx) => homePath(ctx, ".qwen", "skills"),
    skillsLayout: "dir",
    pluginComponents: ["skills"]
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    format: "json",
    configPaths: (ctx) => [ctx.env.OPENCLAW_CONFIG_PATH || homePath(ctx, ".openclaw", "openclaw.json")],
    container: ["mcp", "servers"],
    installMarkers: (ctx) => [homePath(ctx, ".openclaw")],
    binaries: ["openclaw"],
    toEntry: (entry) => ({ url: entry.url, transport: "streamable-http", headers: entry.headers }),
    importEntry: oauthAware({ enabled: "none" }),
    importSources: (doc) => ({
      ...(((doc.mcp as JsonObject | undefined)?.servers as JsonObject | undefined) ?? {}),
      ...((doc.mcpServers as JsonObject | undefined) ?? {})
    }),
    skillsDir: (ctx) => homePath(ctx, ".openclaw", "skills"),
    skillsLayout: "dir",
    pluginComponents: ["skills"]
  },
  {
    id: "hermes",
    displayName: "Hermes",
    format: "yaml",
    configPaths: (ctx) => [homePath(ctx, ".hermes", "config.yaml")],
    container: ["mcp_servers"],
    installMarkers: (ctx) => [homePath(ctx, ".hermes")],
    binaries: ["hermes"],
    toEntry: (entry) => ({ url: entry.url, headers: entry.headers, enabled: entry.enabled }),
    keepDisabled: true,
    importEntry: oauthAware({ enabled: "enabled-flag" }),
    skillsDir: (ctx) => homePath(ctx, ".hermes", "skills"),
    skillsLayout: "dir",
    pluginComponents: ["skills"]
  },
  {
    id: "pi",
    displayName: "Pi",
    format: "json",
    configPaths: (ctx) => [homePath(ctx, ".pi", "agent", "mcp.json")],
    container: ["mcpServers"],
    installMarkers: (ctx) => [homePath(ctx, ".pi")],
    binaries: ["pi"],
    toEntry: httpEntry("http"),
    importEntry: (entry, disabled) => mapStandardEntry(entry, disabled, {
      types: { http: ["http", "remote", "streamable-http"], stdio: ["local", "stdio"] },
      enabled: "enabled-flag"
    }),
    managedName: piManagedName,
    syncBlocker: piSyncBlocker,
    skillsDir: (ctx) => homePath(ctx, ".pi", "agent", "skills"),
    skillsLayout: "dir",
    additionalSkillDirs: (ctx) => [homePath(ctx, ".agents", "skills")],
    projectConfig: ".pi/mcp.json",
    projectSkills: ".pi/skills",
    pluginComponents: ["skills"]
  }
];

/** Ids of every catalogued client, in catalogue order. */
export const CLIENT_IDS: ClientId[] = CLIENT_CATALOGUE.map((client) => client.id);

export function getClientDefinition(id: ClientId): ClientDefinition | undefined {
  return CLIENT_CATALOGUE.find((client) => client.id === id);
}
