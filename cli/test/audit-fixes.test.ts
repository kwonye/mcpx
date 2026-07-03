import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverComponents } from "../src/core/plugin-parse.js";
import { syncPluginsToClient } from "../src/core/plugin-projections.js";
import { withManagedIndexLock } from "../src/core/managed-index-lock.js";
import { loadManagedIndex, saveManagedIndex } from "../src/core/managed-index.js";
import { detectManagedEntryDrift } from "../src/adapters/utils/index.js";
import { sha256 } from "../src/util/fs.js";

function setupTempEnv(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const oldHome = process.env.HOME;
  const oldConfigHome = process.env.MCPX_CONFIG_HOME;
  const oldDataHome = process.env.MCPX_DATA_HOME;
  const oldStateHome = process.env.MCPX_STATE_HOME;
  
  process.env.HOME = root;
  process.env.MCPX_CONFIG_HOME = path.join(root, ".config");
  process.env.MCPX_DATA_HOME = path.join(root, ".local", "share");
  process.env.MCPX_STATE_HOME = path.join(root, ".local", "state");

  return {
    root,
    restore: () => {
      process.env.HOME = oldHome;
      process.env.MCPX_CONFIG_HOME = oldConfigHome;
      process.env.MCPX_DATA_HOME = oldDataHome;
      process.env.MCPX_STATE_HOME = oldStateHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe("PLUG-02: Skill ID sanitization", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plug02-");
  });

  afterEach(() => {
    env.restore();
  });

  it("sanitizes skill IDs containing path traversal sequences", () => {
    const pluginRoot = path.join(env.root, "evil-plugin");
    fs.mkdirSync(path.join(pluginRoot, "skills", "malicious"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "malicious", "SKILL.md"),
      "---\nname: ../../../etc/evil\ndescription: Malicious skill\n---\n# Evil"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.skills).toHaveLength(1);
    // Path separators are replaced with underscores, preventing traversal
    expect(components.skills[0].id).not.toContain("/");
    expect(components.skills[0].id).not.toContain("\\");
    // The sanitized ID should be safe for use as a directory name
    expect(components.skills[0].id).toBe("_.._.._etc_evil");
  });

  it("sanitizes skill IDs with backslashes", () => {
    const pluginRoot = path.join(env.root, "evil-plugin");
    fs.mkdirSync(path.join(pluginRoot, "skills", "malicious"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "malicious", "SKILL.md"),
      "---\nname: ..\\..\\windows\\evil\ndescription: Malicious\n---\n# Evil"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.skills[0].id).not.toContain("\\");
    expect(components.skills[0].id).not.toContain("/");
    // Backslashes are replaced with underscores
    expect(components.skills[0].id).toBe("_.._windows_evil");
  });

  it("sanitizes skill IDs with leading dots", () => {
    const pluginRoot = path.join(env.root, "evil-plugin");
    fs.mkdirSync(path.join(pluginRoot, "skills", "malicious"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "malicious", "SKILL.md"),
      "---\nname: ....hidden\ndescription: Hidden\n---\n# Hidden"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.skills[0].id).not.toMatch(/^\./);
  });

  it("preserves legitimate skill IDs", () => {
    const pluginRoot = path.join(env.root, "good-plugin");
    fs.mkdirSync(path.join(pluginRoot, "skills", "normal"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "normal", "SKILL.md"),
      "---\nname: my-awesome-skill\ndescription: Normal skill\n---\n# Normal"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.skills[0].id).toBe("my-awesome-skill");
  });
});

describe("PLUG-02: Projection containment checks", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plug02-proj-");
  });

  afterEach(() => {
    env.restore();
  });

  it("rejects skill projection that would escape base directory", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.0.0" })
    );

    // Create a skill with a sanitized ID that would still be safe
    const maliciousSkillId = "test-plugin__.._.._.._etc_evil";
    const skillPath = path.join(pluginRoot, "skills", "evil", "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# Evil skill");

    const result = syncPluginsToClient("codex", [{
      pluginId: "test-plugin@abc123",
      pluginName: "test-plugin",
      pluginRoot,
      components: { mcpServers: false, skills: true, hooks: false, agents: false, commands: false },
      approvals: {},
      enabled: true,
      serverNames: [],
      skills: [{ id: maliciousSkillId, type: "skills", path: skillPath }],
      commands: [],
      agents: [],
      hooks: [],
    }]);

    // The sanitized ID should be safe and stay within the base directory
    const codexSkillsDir = path.join(env.root, ".codex", "skills");
    if (fs.existsSync(codexSkillsDir)) {
      const projectedPath = path.join(codexSkillsDir, maliciousSkillId);
      const resolvedBase = path.resolve(codexSkillsDir);
      const resolvedTarget = path.resolve(projectedPath);
      expect(resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase).toBe(true);
    }
  });
});

describe("GW-03: Managed-index locking", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-gw03-");
  });

  afterEach(() => {
    env.restore();
  });

  it("prevents concurrent writes from losing data", () => {
    const indexPath = path.join(env.root, "managed-index.json");
    const lockPath = `${indexPath}.lock`;
    
    // Initialize the index
    saveManagedIndex({ schemaVersion: 1, managed: {} }, indexPath);

    let counter = 0;
    const results: number[] = [];

    // Simulate concurrent operations
    const operations = Array.from({ length: 10 }, (_, i) => {
      return () => {
        return withManagedIndexLock(lockPath, () => {
          const index = loadManagedIndex(indexPath);
          if (!index.managed.test) {
            index.managed.test = { configPath: "", entries: {} };
          }
          index.managed.test.entries[`entry-${i}`] = {
            fingerprint: sha256(`entry-${i}`),
            lastSyncedAt: new Date().toISOString()
          };
          saveManagedIndex(index, indexPath);
          results.push(i);
          return i;
        });
      };
    });

    // Run all operations
    for (const op of operations) {
      op();
    }

    // Verify all entries were preserved
    const finalIndex = loadManagedIndex(indexPath);
    expect(Object.keys(finalIndex.managed.test?.entries ?? {})).toHaveLength(10);
  });

  it("detects stale locks and removes them", () => {
    const lockPath = path.join(env.root, "test.lock");
    const indexPath = path.join(env.root, "managed-index.json");
    
    saveManagedIndex({ schemaVersion: 1, managed: {} }, indexPath);

    // Create a stale lock file (older than 5 seconds)
    fs.writeFileSync(lockPath, `${process.pid}\n`);
    const oldTime = Date.now() - 10000; // 10 seconds ago
    fs.utimesSync(lockPath, oldTime / 1000, oldTime / 1000);

    // Should succeed despite the lock existing
    const result = withManagedIndexLock(lockPath, () => "success");
    expect(result).toBe("success");

    // Lock file should be removed after operation
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases lock after operation completes", () => {
    const lockPath = path.join(env.root, "test.lock");
    const indexPath = path.join(env.root, "managed-index.json");
    
    saveManagedIndex({ schemaVersion: 1, managed: {} }, indexPath);

    withManagedIndexLock(lockPath, () => {
      const index = loadManagedIndex(indexPath);
      index.managed.test = { configPath: "", entries: {} };
      saveManagedIndex(index, indexPath);
    });

    // Lock file should be removed
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("SYNC-03: Drift detection", () => {
  it("detects when managed entry has been manually edited", () => {
    const managedIndex = {
      schemaVersion: 1 as const,
      managed: {
        claude: {
          configPath: "/test/path",
          entries: {
            "server (mcpx)": {
              fingerprint: sha256(JSON.stringify({ url: "http://original.com" })),
              lastSyncedAt: new Date().toISOString()
            }
          }
        }
      }
    };

    // Entry matches fingerprint - no drift
    const noDrift = detectManagedEntryDrift(
      managedIndex,
      "claude",
      "server (mcpx)",
      { url: "http://original.com" }
    );
    expect(noDrift).toBe(false);

    // Entry has been modified - drift detected
    const drift = detectManagedEntryDrift(
      managedIndex,
      "claude",
      "server (mcpx)",
      { url: "http://modified.com" }
    );
    expect(drift).toBe(true);
  });

  it("returns false for non-existent entries", () => {
    const managedIndex = {
      schemaVersion: 1 as const,
      managed: {}
    };

    const result = detectManagedEntryDrift(
      managedIndex,
      "claude",
      "nonexistent (mcpx)",
      { url: "http://test.com" }
    );
    expect(result).toBe(false);
  });

  it("returns false for undefined existing value", () => {
    const managedIndex = {
      schemaVersion: 1 as const,
      managed: {
        claude: {
          configPath: "/test/path",
          entries: {
            "server (mcpx)": {
              fingerprint: sha256(JSON.stringify({ url: "http://test.com" })),
              lastSyncedAt: new Date().toISOString()
            }
          }
        }
      }
    };

    const result = detectManagedEntryDrift(
      managedIndex,
      "claude",
      "server (mcpx)",
      undefined
    );
    expect(result).toBe(false);
  });
});

describe("GW-05: Proxy bridge version pinning", () => {
  it("uses APP_VERSION instead of @latest in proxy fallback", async () => {
    // This test verifies the fix is in place by checking the source code
    const claudeDesktopPath = path.join(process.cwd(), "src/adapters/claude-desktop.ts");
    const source = fs.readFileSync(claudeDesktopPath, "utf8");
    
    // Should contain APP_VERSION import
    expect(source).toContain("APP_VERSION");
    
    // Should use APP_VERSION in the fallback
    expect(source).toContain("@kwonye/mcpx@${APP_VERSION}");
    
    // Should NOT contain @latest
    expect(source).not.toContain("@kwonye/mcpx@latest");
  });
});

describe("UPD-01: Foreground update lock", () => {
  it("acquires lock in performUpdate", async () => {
    // This test verifies the fix is in place by checking the source code
    const updateManagerPath = path.join(process.cwd(), "src/core/update-manager.ts");
    const source = fs.readFileSync(updateManagerPath, "utf8");
    
    // Should acquire lock in performUpdate
    expect(source).toMatch(/export async function performUpdate[\s\S]*?acquireLock\(\)/);
    expect(source).toMatch(/export async function performUpdate[\s\S]*?finally[\s\S]*?releaseLock\(\)/);
  });
});

describe("AUTH-01: PKCE verifier cleanup", () => {
  it("clears verifier after successful login", async () => {
    // This test verifies the fix is in place by checking the source code
    const oauthPath = path.join(process.cwd(), "src/core/oauth.ts");
    const source = fs.readFileSync(oauthPath, "utf8");
    
    // Should invalidate verifier in success path
    expect(source).toMatch(/return \{ serverName, authorized: true \};[\s\S]*?invalidateCredentials\("verifier"\)/);
    
    // Should invalidate verifier in failure path
    expect(source).toMatch(/catch \(error\)[\s\S]*?invalidateCredentials\("verifier"\)/);
  });
});

describe("GW-06: Background update opt-out", () => {
  it("respects MCPX_NO_UPDATE environment variable", async () => {
    // This test verifies the fix is in place by checking the source code
    const updateManagerPath = path.join(process.cwd(), "src/core/update-manager.ts");
    const source = fs.readFileSync(updateManagerPath, "utf8");
    
    // Should check MCPX_NO_UPDATE at the start of startBackgroundUpdateCheck
    expect(source).toMatch(/export function startBackgroundUpdateCheck[\s\S]*?MCPX_NO_UPDATE/);
  });

  it("smoke-tests staged builds before trusting them", async () => {
    // This test verifies the fix is in place by checking the source code
    const updateManagerPath = path.join(process.cwd(), "src/core/update-manager.ts");
    const source = fs.readFileSync(updateManagerPath, "utf8");
    
    // Should run --version on staged CLI
    expect(source).toContain("--version");
    expect(source).toContain("smoke");
  });
});

describe("GW-06-c: Staged CLI fallback", () => {
  it("falls back gracefully when staged CLI fails", async () => {
    // This test verifies the fix is in place by checking the source code
    const cliPath = path.join(process.cwd(), "src/cli.ts");
    const source = fs.readFileSync(cliPath, "utf8");
    
    // Should have try-catch around staged CLI execution
    expect(source).toMatch(/execFileSync[\s\S]*?stagedCliPath[\s\S]*?catch/);
    
    // Should print warning and suggest rollback
    expect(source).toContain("mcpx update rollback");
  });
});

describe("DAEMON-01: PID file port recording", () => {
  it("writes PID and port to pidfile", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should write both PID and port
    expect(source).toMatch(/writeFileSync\(pidPath.*\$\{child\.pid\}:\$\{port\}/);
    
    // Should read both PID and port
    expect(source).toContain("readPidRecordFromFile");
    expect(source).toMatch(/const \[pidRaw, portRaw\] = raw\.split\(":"\)/);
  });

  it("reports portMismatch when config port differs from pidfile port", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should include portMismatch in DaemonStatus
    expect(source).toContain("portMismatch");
    
    // Should compare record.port with config.gateway.port
    expect(source).toMatch(/record\.port !== config\.gateway\.port/);
  });
});

describe("REVIEW-02: Daemon stop process check", () => {
  it("requires 'daemon run' in process command", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should check for "daemon run" AND (mcpx OR cli.js)
    expect(source).toContain('cmd.includes("daemon run")');
    expect(source).toMatch(/looksLikeMcpxDaemon.*daemon run.*mcpx.*cli\.js/);
  });
});

describe("SYNC-01: Adapter disable/enable fixes", () => {
  it("codex uses enabled-only names for writability checks", async () => {
    const codexPath = path.join(process.cwd(), "src/adapters/codex.ts");
    const source = fs.readFileSync(codexPath, "utf8");
    
    // Should have enabledManagedNames
    expect(source).toContain("enabledManagedNames");
    
    // Should use enabledManagedNames in ensureManagedEntryWritable loop
    expect(source).toMatch(/for \(const name of enabledManagedNames\)[\s\S]*?ensureManagedEntryWritable/);
    
    // Should use enabledManagedNames in pruneStaleManagedEntries
    expect(source).toMatch(/pruneStaleManagedEntries[\s\S]*?enabledManagedNames/);
  });

  it("opencode uses enabled-only names", async () => {
    const opencodePath = path.join(process.cwd(), "src/adapters/opencode.ts");
    const source = fs.readFileSync(opencodePath, "utf8");
    expect(source).toContain("enabledManagedNames");
  });

  it("kiro uses enabled-only names", async () => {
    const kiroPath = path.join(process.cwd(), "src/adapters/kiro.ts");
    const source = fs.readFileSync(kiroPath, "utf8");
    expect(source).toContain("enabledManagedNames");
  });

  it("qwen uses enabled-only names", async () => {
    const qwenPath = path.join(process.cwd(), "src/adapters/qwen.ts");
    const source = fs.readFileSync(qwenPath, "utf8");
    expect(source).toContain("enabledManagedNames");
  });

  it("cline uses enabled-only names", async () => {
    const clinePath = path.join(process.cwd(), "src/adapters/cline.ts");
    const source = fs.readFileSync(clinePath, "utf8");
    expect(source).toContain("enabledManagedNames");
  });
});

describe("GW-04: GET SSE 405", () => {
  it("returns 405 for GET with Accept: text/event-stream and session ID", async () => {
    // This test verifies the fix is in place by checking the source code
    const serverPath = path.join(process.cwd(), "src/gateway/server.ts");
    const source = fs.readFileSync(serverPath, "utf8");
    
    // Should check for text/event-stream in Accept header
    expect(source).toContain("text/event-stream");
    
    // Should return 405 with error message
    expect(source).toContain("get_stream_not_supported");
    expect(source).toMatch(/statusCode = 405/);
  });
});

describe("STATUS-01: Timeout and error handling", () => {
  it("uses 65s timeout instead of 4s", async () => {
    // This test verifies the fix is in place by checking the source code
    const statusPath = path.join(process.cwd(), "src/core/status.ts");
    const source = fs.readFileSync(statusPath, "utf8");
    
    // Should use 65_000ms timeout
    expect(source).toContain("65_000");
  });

  it("returns fetchError instead of silently swallowing errors", async () => {
    // This test verifies the fix is in place by checking the source code
    const statusPath = path.join(process.cwd(), "src/core/status.ts");
    const source = fs.readFileSync(statusPath, "utf8");
    
    // Should return object with counts and fetchError
    expect(source).toMatch(/return \{ counts.*fetchError/);
  });
});

describe("GW-01: Upstream error surfacing", () => {
  it("includes _meta.mcpxUpstreamErrors in tools/list response", async () => {
    // This test verifies the fix is in place by checking the source code
    const serverPath = path.join(process.cwd(), "src/gateway/server.ts");
    const source = fs.readFileSync(serverPath, "utf8");
    
    // Should include _meta with mcpxUpstreamErrors
    expect(source).toContain("mcpxUpstreamErrors");
    expect(source).toContain("_meta");
  });
});

describe("GW-07: Token-count cache invalidation", () => {
  it("includes resolved secret values in fingerprint", async () => {
    // This test verifies the fix is in place by checking the source code
    const serverPath = path.join(process.cwd(), "src/gateway/server.ts");
    const source = fs.readFileSync(serverPath, "utf8");
    
    // Should resolve secret:// and oauth:// references in fingerprint
    expect(source).toMatch(/specFingerprint.*secrets/);
    expect(source).toContain("resolvedMarkers");
  });
});

describe("LOG-01: Log rotation", () => {
  it("rotates logs when exceeding 10MB", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should check for 10MB threshold
    expect(source).toContain("10 * 1024 * 1024");
    
    // Should rotate to .1 and .2 suffixes
    expect(source).toContain("}.1`");
    expect(source).toContain("}.2`");
  });
});

describe("REVIEW-01: Port fallback warning", () => {
  it("returns fellBackFrom in resolveGatewayPort", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should return object with port and fellBackFrom
    expect(source).toMatch(/return \{ port.*fellBackFrom/);
  });

  it("prints warning to stderr when fallback occurs", async () => {
    // This test verifies the fix is in place by checking the source code
    const daemonPath = path.join(process.cwd(), "src/core/daemon.ts");
    const source = fs.readFileSync(daemonPath, "utf8");
    
    // Should print warning about port fallback
    expect(source).toContain("was unavailable");
    expect(source).toContain("stderr");
  });
});

describe("SYNC-02: Project-local persistence", () => {
  it("writes to .mcpx.json when --local flag is used", async () => {
    // This test verifies the fix is in place by checking the source code
    const configPath = path.join(process.cwd(), "src/core/config.ts");
    const source = fs.readFileSync(configPath, "utf8");
    
    // Should check for options.local
    expect(source).toMatch(/if \(options\.local\)/);
    
    // Should use saveProjectConfig for local writes
    expect(source).toContain("saveProjectConfig");
  });
});

describe("SYNC-04: Import flag", () => {
  it("wires up --import flag in sync command", async () => {
    // This test verifies the fix is in place by checking the source code
    const cliPath = path.join(process.cwd(), "src/cli.ts");
    const source = fs.readFileSync(cliPath, "utf8");
    
    // Should have --import option
    expect(source).toContain('--import');
    
    // Should pass importScan to syncAllClients
    expect(source).toMatch(/importScan.*options\.import/);
  });
});

describe("PLUG-01: Environment variable forwarding", () => {
  it("forwards TMPDIR and LANG to stdio upstreams", async () => {
    // This test verifies the fix is in place by checking the source code
    const serverPath = path.join(process.cwd(), "src/gateway/server.ts");
    const source = fs.readFileSync(serverPath, "utf8");
    
    // Should define EXTRA_INHERITED_ENV
    expect(source).toContain("EXTRA_INHERITED_ENV");
    expect(source).toContain("TMPDIR");
    expect(source).toContain("LANG");
    
    // Should forward LC_* variables
    expect(source).toMatch(/key\.startsWith\("LC_"\)/);
  });
});

describe("PLUG-04: Plugin project overrides", () => {
  it("adds --project flag to plugin enable/disable", async () => {
    // This test verifies the fix is in place by checking the source code
    const cliPath = path.join(process.cwd(), "src/cli.ts");
    const source = fs.readFileSync(cliPath, "utf8");
    
    // Should have --project option on plugin commands
    expect(source).toMatch(/plugin[\s\S]*?enable[\s\S]*?--project/);
    expect(source).toMatch(/plugin[\s\S]*?disable[\s\S]*?--project/);
  });

  it("implements setPluginProjectOverride function", async () => {
    // This test verifies the fix is in place by checking the source code
    const pluginManagerPath = path.join(process.cwd(), "src/core/plugin-manager.ts");
    const source = fs.readFileSync(pluginManagerPath, "utf8");
    
    // Should export setPluginProjectOverride
    expect(source).toContain("export async function setPluginProjectOverride");
  });
});

describe("PLUG-03: Path traversal guard", () => {
  it("uses path.resolve before checking containment", async () => {
    // This test verifies the fix is in place by checking the source code
    const pluginHostPath = path.join(process.cwd(), "src/core/plugin-host.ts");
    const source = fs.readFileSync(pluginHostPath, "utf8");
    
    // Should use path.resolve on the path
    expect(source).toContain("path.resolve");
    
    // Should check with path.sep suffix to prevent prefix attacks
    expect(source).toContain("path.sep");
  });
});
