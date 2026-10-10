import { loadConfig } from "./config.js";
import { loadManagedIndex } from "./managed-index.js";
import { installationAdapters } from "./harnesses.js";
import { readNativeDocument, nativeServers } from "./native-document.js";
import { sha256 } from "../util/fs.js";

/** Read-only synchronization preview; credentials and raw configurations stay local. */
export function planSynchronization(targets?: string[]) {
  const config = loadConfig(), index = loadManagedIndex();
  return { revision: config.revision ?? 0, harnesses: installationAdapters(config).filter(({ installation }) => !targets?.length || targets.includes(installation.id)).map(({ installation, adapter }) => {
    const changes: Array<{ name: string; action: string }> = [];
    if (installation.mode === "observe") return { id: installation.id, configPath: installation.configPath, changes, message: "Observe only" };
    try {
      const native = installation.configPath ? nativeServers(installation.harness, readNativeDocument(installation.configPath)) : {};
      const wanted = new Set(Object.entries(config.servers).filter(([, spec]) => spec.enabled !== false && (!spec.scope || spec.scope === installation.projectPath)).map(([name]) => adapter.managedName?.(name) ?? `${name} (mcpx)`));
      const recorded = index.managed[installation.id]?.entries ?? {};
      for (const name of wanted) changes.push({ name, action: native[name] === undefined ? "create" : !recorded[name] || sha256(JSON.stringify(native[name])) !== recorded[name].fingerprint ? "conflict" : "reconcile" });
      for (const name of Object.keys(recorded)) if (!wanted.has(name)) changes.push({ name, action: native[name] !== undefined && sha256(JSON.stringify(native[name])) !== recorded[name].fingerprint ? "conflict" : "remove" });
      return { id: installation.id, configPath: installation.configPath, changes, message: installation.reload };
    } catch { return { id: installation.id, configPath: installation.configPath, changes, message: "Configuration could not be read safely" }; }
  }) };
}
