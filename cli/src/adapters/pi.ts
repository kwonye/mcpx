import path from "node:path";
import { homeDir } from "../core/paths.js";
import { JsonHarnessAdapter, readNativeJson } from "./json.js";
import type { McpxConfig, SyncClientOptions, SyncResult } from "../types.js";

export class PiAdapter extends JsonHarnessAdapter {
  constructor(projectPath?: string) {
    super({ id: projectPath ? `pi@${path.resolve(projectPath)}` : "pi", configPath: () => projectPath ? path.join(projectPath, ".pi", "mcp.json") : path.join(homeDir(), ".pi", "agent", "mcp.json"), skillsPath: () => projectPath ? path.join(projectPath, ".pi", "skills") : path.join(homeDir(), ".pi", "agent", "skills") });
  }
  additionalSkillDirectories() { return [path.join(homeDir(), ".agents", "skills")]; }
  managedName(name: string) { return name.replace(/[^A-Za-z0-9_-]/g, "_") + "__mcpx"; }
  override syncGateway(config: McpxConfig, options: SyncClientOptions): SyncResult {
    const settings = readNativeJson(path.join(path.dirname(this.detectConfigPath()), "settings.json"));
    if ((settings.extensions ?? []).includes("-builtin:mcp")) return { clientId: this.id, status: "ERROR", message: "Pi built-in MCP is disabled. Enable it before syncing.", configPath: this.detectConfigPath() };
    // Pi only allows letters, digits, '_' and '-' in MCP server names.
    const names = new Set<string>();
    const entries = options.managedEntries.map(entry => {
      const name = this.managedName(entry.name.replace(/ \(mcpx\)$/, ""));
      const identity = name.replace(/-/g, "_");
      if (names.has(identity)) throw new Error("Pi server names collide after normalization; rename the integrations.");
      names.add(identity);
      return { ...entry, name };
    });
    return super.syncGateway(config, { ...options, managedEntries: entries });
  }
}
