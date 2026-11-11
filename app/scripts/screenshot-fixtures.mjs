// Realistic fixture data for renderer screenshots. Pure data: no imports.
const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();

const CLIENT_IDS = ["claude", "claude-desktop", "codex", "cursor", "cline", "opencode", "kiro", "vscode", "qwen", "openclaw", "hermes"];
const MANAGED = ["claude", "codex", "cursor", "vscode"];

function clientsFor(name, enabled) {
  return CLIENT_IDS.map((clientId) => ({
    clientId,
    managed: enabled && MANAGED.includes(clientId),
    status: MANAGED.includes(clientId) ? (clientId === "vscode" ? "ERROR" : "SYNCED") : "SKIPPED",
    lastSyncAt: ago(12)
  }));
}

function server(name, spec, authBindings = []) {
  const target = spec.transport === "http" ? spec.url : [spec.command, ...(spec.args ?? [])].join(" ");
  return { name, enabled: spec.enabled !== false, transport: spec.transport, target, spec, authBindings, clients: clientsFor(name, spec.enabled !== false) };
}

export const servers = [
  server("github", { transport: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "oauth://github" } }, [{ kind: "header", key: "Authorization", value: "oauth://github" }]),
  server("linear", { transport: "http", url: "https://mcp.linear.app/mcp" }),
  server("filesystem", { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"] }),
  server("postgres", { transport: "stdio", command: "uvx", args: ["mcp-server-postgres"], env: { DATABASE_URL: "secret://auth_postgres_env_database_url", PGSSLMODE: "require" } }, [
    { kind: "env", key: "DATABASE_URL", value: "secret://auth_postgres_env_database_url", secretName: "auth_postgres_env_database_url" },
    { kind: "env", key: "PGSSLMODE", value: "require" }
  ]),
  server("sentry", { transport: "http", url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "secret://auth_sentry_header_authorization" } }, [{ kind: "header", key: "Authorization", value: "secret://auth_sentry_header_authorization" }]),
  server("slack", { transport: "http", url: "https://mcp.slack.com/mcp", enabled: false })
];

export const tokenCounts = {
  gatewayRunning: true,
  counts: {
    github: { tools: 41, resources: 2, prompts: 0, total: 18_400 },
    filesystem: { tools: 11, resources: 0, prompts: 0, total: 3_150 },
    postgres: { tools: 0, resources: 0, prompts: 0, total: 0, error: "connect ECONNREFUSED 127.0.0.1:5432", errorCode: "unreachable" },
    sentry: { tools: 16, resources: 0, prompts: 3, total: 7_900 }
  },
  totalGlobalTokens: 29_450,
  totalProjectTokens: { "/Users/ana/src/storefront": 21_550, "/Users/ana/src/infra": 29_450 }
};

export const projects = {
  "/Users/ana/src/storefront": { name: "storefront", path: "/Users/ana/src/storefront", disabledServers: ["postgres"] },
  "/Users/ana/src/infra": { name: "infra", path: "/Users/ana/src/infra" }
};

export const clientsConfig = {
  claude: { status: "SYNCED", lastSyncAt: ago(12), configPath: "/Users/ana/.claude.json" },
  codex: { status: "SYNCED", lastSyncAt: ago(12), configPath: "/Users/ana/.codex/config.toml" },
  cursor: { status: "SYNCED", lastSyncAt: ago(12), configPath: "/Users/ana/.cursor/mcp.json" },
  vscode: { status: "ERROR", lastSyncAt: ago(12), configPath: "/Users/ana/Library/Application Support/Code/User/mcp.json", message: "mcp.json isn't valid JSON (line 14). Fix it or remove the file, then sync again." },
  "claude-desktop": { status: "SKIPPED" },
  cline: { status: "SKIPPED" }
};

export function statusReport({ empty = false, running = true } = {}) {
  return {
    gatewayUrl: "http://127.0.0.1:37373/mcp",
    daemon: running ? { running: true, pid: 48213, port: 37373, pidFile: "", logFile: "/Users/ana/.local/state/mcpx/daemon.log" } : { running: false, pidFile: "", logFile: "/Users/ana/.local/state/mcpx/daemon.log" },
    upstreamCount: empty ? 0 : servers.length,
    servers: empty ? [] : servers,
    clients: empty ? {} : clientsConfig,
    projects: empty ? {} : projects
  };
}

const HARNESS_LABELS = { claude: "Claude Code", "claude-desktop": "Claude Desktop", codex: "Codex", cursor: "Cursor", cline: "Cline", opencode: "OpenCode", kiro: "Kiro", vscode: "VS Code", qwen: "Qwen Code", openclaw: "OpenClaw", hermes: "Hermes" };

export function managementSnapshot({ empty = false } = {}) {
  const harnesses = CLIENT_IDS.map((id) => ({
    id: `${id}:global`,
    harness: id,
    label: HARNESS_LABELS[id],
    scope: "global",
    configPath: clientsConfig[id]?.configPath ?? null,
    skillPaths: [],
    detected: MANAGED.includes(id) || id === "opencode",
    mode: id === "opencode" ? "observe" : id === "codex" ? "selected" : "automatic",
    transports: ["http"],
    components: ["mcp", "skills"],
    reload: "Restart the app",
    sync: empty ? undefined : clientsConfig[id]?.status && clientsConfig[id].status !== "SKIPPED" ? clientsConfig[id] : undefined
  }));
  return {
    revision: 42,
    capturedAt: new Date(now).toISOString(),
    harnesses,
    servers: [],
    skills: [],
    packages: [],
    plugins: [],
    operations: empty ? [] : [
      { id: "1", label: "Moved 3 items from Cursor into mcpx", phase: "complete", startedAt: ago(90), updatedAt: ago(89), progress: 1, undoable: true, details: ["filesystem (server)", "postgres (server)", "release-notes (skill)"] },
      { id: "2", label: "Synced 4 apps", phase: "complete", startedAt: ago(12), updatedAt: ago(12), progress: 1 },
      { id: "3", label: "Moved github from Claude Code into mcpx", phase: "rolled-back", startedAt: ago(60 * 26), updatedAt: ago(60 * 25), progress: 1 }
    ]
  };
}

export const adoptionPlan = {
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: new Date(now).toISOString(),
  configHash: "abc",
  errors: [],
  items: [
    { id: "a", harness: "cursor", kind: "mcp", name: "notion", path: "/Users/ana/.cursor/mcp.json", nativeKey: "notion", fingerprint: "1", action: "import", canonicalId: "notion", reload: "" },
    { id: "b", harness: "claude", kind: "skill", name: "pr-review", path: "/Users/ana/.claude/skills/pr-review", nativeKey: "pr-review", fingerprint: "2", action: "import", canonicalId: "pr-review", reload: "" },
    { id: "c", harness: "codex", kind: "mcp", name: "github", path: "/Users/ana/.codex/config.toml", nativeKey: "github", fingerprint: "3", action: "reuse", canonicalId: "github", reload: "" },
    { id: "d", harness: "vscode", kind: "mcp", name: "postgres", path: "/Users/ana/Library/Application Support/Code/User/mcp.json", nativeKey: "postgres", fingerprint: "4", action: "conflict", canonicalId: "postgres", reason: "A different postgres server is already in mcpx.", reload: "" }
  ]
};

const discovered = (servers = [], skills = []) => ({ skills: skills.map((id) => ({ id, type: "skills", path: "", description: undefined })), commands: [], agents: [], hooks: [], mcpServers: servers.map((id) => ({ id, command: "node" })) });

export const plugins = [
  { id: "superpowers", name: "superpowers", source: "obra/superpowers", version: "4.2.0", ref: "main", resolvedSha: "", installedAt: ago(60 * 24 * 6), root: "", dataDir: "", components: { mcpServers: false, skills: true, hooks: true, agents: true, commands: true }, approvals: { commands: true }, discovered: discovered([], ["brainstorming", "writing-plans", "test-driven-development"]), enabled: true, status: "healthy", serverNames: [], projectedClients: ["claude", "codex", "cursor"], marketplace: { name: "claude-plugins", pluginName: "superpowers", sourceFingerprint: "" }, previous: { version: "4.1.3", resolvedSha: "", root: "" } },
  { id: "context7", name: "context7", source: "upstash/context7", version: "1.0.14", ref: "main", resolvedSha: "", installedAt: ago(60 * 24 * 20), root: "", dataDir: "", components: { mcpServers: true, skills: false, hooks: false, agents: false, commands: false }, approvals: { mcpServers: true }, discovered: discovered(["context7"]), enabled: true, status: "healthy", serverNames: ["context7"], projectedClients: ["claude", "codex", "cursor", "vscode"], pinned: true },
  { id: "playwright", name: "playwright", source: "microsoft/playwright-mcp", version: "0.0.41", ref: "main", resolvedSha: "", installedAt: ago(60 * 3), root: "", dataDir: "", components: { mcpServers: true, skills: false, hooks: false, agents: false, commands: false }, discovered: discovered(["playwright"]), enabled: false, status: "healthy", serverNames: ["playwright"], projectedClients: [], approvals: { mcpServers: false }, projectOverrides: { "/Users/ana/src/storefront": { enabled: true } } }
];

export const marketplaces = [
  { name: "claude-plugins", displayName: "Claude plugins", source: "anthropics/claude-plugins-official", sourceType: "github", builtIn: true, autoUpdate: true, addedAt: ago(60 * 24 * 30), lastCheckedAt: ago(40), status: "ready" },
  { name: "codex-plugins", displayName: "Codex plugins", source: "openai/codex-plugins", sourceType: "github", builtIn: true, autoUpdate: true, addedAt: ago(60 * 24 * 30), lastCheckedAt: ago(40), status: "ready" },
  { name: "team", displayName: "Acme team catalog", source: "https://plugins.acme.dev/marketplace.json", sourceType: "hosted-json", builtIn: false, autoUpdate: false, addedAt: ago(60 * 24 * 2), lastCheckedAt: ago(60 * 24 * 2), status: "stale", error: "Last refresh timed out after 30s." }
];

const listing = (id, displayName, marketplace, description, category, extra = {}) => ({ id: `${marketplace}/${id}`, name: id, displayName, marketplace, description, category, tags: [category.toLowerCase()], source: {}, supportedCapabilities: ["skills", "commands"], unsupportedCapabilities: [], compatible: true, installed: false, version: "1.0.0", author: { name: "Community" }, ...extra });

export const listings = [
  listing("superpowers", "Superpowers", "claude-plugins", "A complete development workflow: brainstorming, planning, TDD and review skills.", "Workflow", { installed: true }),
  listing("context7", "Context7", "claude-plugins", "Up-to-date library docs pulled straight into your prompts.", "Docs", { installed: true, supportedCapabilities: ["mcpServers"] }),
  listing("frontend-design", "Frontend design", "claude-plugins", "Skills for building polished, accessible interfaces.", "Design"),
  listing("sentry", "Sentry", "codex-plugins", "Investigate production errors and releases without leaving your editor.", "Monitoring", { supportedCapabilities: ["mcpServers", "skills"] }),
  listing("vercel", "Vercel", "codex-plugins", "Deploy previews, read build logs and manage environment variables.", "Deploy", { supportedCapabilities: ["mcpServers"], unsupportedCapabilities: ["hooks"] }),
  listing("acme-runbooks", "Acme runbooks", "team", "Incident runbooks and on-call checklists for the platform team.", "Operations", { compatible: false, supportedCapabilities: [], unsupportedCapabilities: ["agents"] })
];

export const skills = [
  { id: "release-notes", content: "---\nname: release-notes\ndescription: Draft release notes from merged pull requests.\n---\n\n# Release notes\n\nWhen asked for release notes:\n\n1. List merged PRs since the last tag with `gh pr list --state merged`.\n2. Group them under Features, Fixes and Internal.\n3. Write one plain sentence per change, user-facing first.\n4. Link each PR number.\n", source: "authored" },
  { id: "pr-review", content: "---\nname: pr-review\ndescription: Review a pull request for correctness and clarity.\n---\n\nRead the diff carefully...\n", source: "authored" },
  { id: "brainstorming", content: "---\nname: brainstorming\ndescription: Turn rough ideas into designs through questions.\n---\n\nInstalled from superpowers.\n", source: "installed", readOnly: true },
  { id: "writing-plans", content: "---\nname: writing-plans\ndescription: Write implementation plans.\n---\n", source: "installed", readOnly: true }
];

export const telemetry = (acknowledged) => ({
  schemaVersion: 1,
  usageAnalyticsEnabled: true,
  errorReportingEnabled: true,
  noticeAcknowledgedVersion: acknowledged ? 1 : 0,
  installationId: null,
  milestones: {},
  usageActive: acknowledged,
  errorsActive: acknowledged,
  blockedReason: acknowledged ? undefined : "notice_required"
});
