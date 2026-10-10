import { z } from "zod";
import { loadConfig, loadMergedConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { SecretsManager } from "./secrets.js";
import { addServer, updateServer, removeServer, setServerEnabled, setProjectServerEnabled, registerProject, unregisterProject } from "./registry.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { listHarnesses } from "./harnesses.js";
import { planAdoption, applyAdoption, protectServerSecrets, adoptionPlanSchema } from "./adoption.js";
import { listOperations, rollbackOperation } from "./operations.js";
import { listSkills } from "./skills.js";
import { parseCliAddCommand } from "./add-command.js";
import { probeHttpAuthRequirement } from "./auth-probe.js";
import { clearOAuthCredentials } from "./oauth.js";
import type { UpstreamServerSpec } from "../types.js";

const string = z.string().min(1);
const serverSchema = z.discriminatedUnion("transport", [z.object({ transport: z.literal("http"), url: z.url(), headers: z.record(z.string(), z.string()).optional(), enabled: z.boolean().optional(), scope: z.string().optional() }), z.object({ transport: z.literal("stdio"), command: string, args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), cwd: string.optional(), enabled: z.boolean().optional(), scope: z.string().optional() })]);
export async function syncManaged(targets?: string[]) {
  const config = loadConfig();
  const detected = listHarnesses(config).filter(h => h.mode !== "observe" && (h.detected || config.harnesses?.[h.id])).map(h => h.id);
  const summary = syncAllClients(config, new SecretsManager(), { targetClients: targets ?? detected });
  await mutateConfig(fresh => persistSyncState(summary, fresh));
  return summary;
}
export async function managementCommand(method: string, raw: unknown[]): Promise<unknown> {
  if (method === "status") { const { buildStatusReport } = await import("./status.js"); const { loadManagedIndex } = await import("./managed-index.js"); return buildStatusReport(loadMergedConfig(), loadManagedIndex()); }
  if (method === "auth.configure") {
    const [input] = z.tuple([z.object({ serverName: string, headerName: string, authValue: string, secretName: string.optional(), raw: z.boolean().optional() })]).parse(raw);
    const { resolveAuthTarget, maybePrefixBearer, applyAuthReference } = await import("./server-auth.js");
    const config = loadConfig();
    const spec = config.servers[input.serverName];
    if (!spec) throw new Error("Unknown server");
    const target = resolveAuthTarget(spec, input.headerName);
    const key = input.secretName ?? `auth_${input.serverName}_${input.headerName}`.replace(/[^A-Za-z0-9._-]/g, "_");
    new SecretsManager().setSecret(key, maybePrefixBearer(target, input.authValue, input.raw ?? false));
    await mutateConfig(fresh => applyAuthReference(fresh.servers[input.serverName], target, `secret://${key}`));
    return { configured: true, sync: await syncManaged() };
  }
  if (method === "snapshot") {
    const config = loadConfig();
    return { revision: config.revision ?? 0, capturedAt: new Date().toISOString(), harnesses: listHarnesses(config), operations: listOperations(), servers: Object.entries(config.servers).map(([name, spec]) => ({ name, transport: spec.transport, enabled: spec.enabled !== false, scope: spec.scope })), skills: listSkills().map(skill => ({ id: skill.id, source: skill.source, readOnly: skill.readOnly })), packages: Object.values(config.packages ?? {}), plugins: Object.values(config.plugins ?? {}).map(plugin => ({ id: plugin.id, name: plugin.name, version: plugin.version, status: plugin.status, enabled: plugin.enabled })) };
  }
  if (method === "adoption.plan") return planAdoption(z.tuple([z.array(string).optional()]).parse(raw)[0]);
  if (method === "adoption.apply") { const [plan, selected] = z.tuple([adoptionPlanSchema, z.array(string).optional()]).parse(raw); return applyAdoption(plan, selected); }
  if (method === "operation.rollback") return rollbackOperation(z.tuple([z.uuid()]).parse(raw)[0]);
  if (method === "package.pin") {
    const [id, pinned] = z.tuple([string, z.boolean()]).parse(raw);
    await mutateConfig(config => { if (!config.packages?.[id]) throw new Error("Unknown native package"); config.packages[id].pinned = pinned; });
    return { id, pinned };
  }
  if (method === "harness.mode") {
    const [id, mode] = z.tuple([string, z.enum(["observe", "selected", "automatic"])]).parse(raw);
    if (!listHarnesses(loadConfig()).some(h => h.id === id)) throw new Error("Unknown harness installation");
    await mutateConfig(config => { config.harnesses ??= {}; config.harnesses[id] = { mode }; });
    return { id, mode };
  }
  if (method === "sync") return syncManaged(z.tuple([z.array(string).optional()]).parse(raw)[0]);
  if (method === "server.add" || method === "server.update" || method === "server.command") {
    const [name, spec, resolvedSecrets] = method === "server.command" ? (() => { const [command] = z.tuple([string]).parse(raw); const parsed = parseCliAddCommand(command); return [parsed.name, parsed.spec, undefined] as const; })() : z.tuple([string, serverSchema, z.record(z.string(), z.string()).optional()]).parse(raw);
    const secrets = new SecretsManager();
    for (const [key, value] of Object.entries(resolvedSecrets ?? {})) secrets.setSecret(key, value);
    const safe = protectServerSecrets(name, spec as UpstreamServerSpec, secrets);
    await mutateConfig(config => { if (method === "server.update") updateServer(config, name, safe); else addServer(config, name, safe, true); });
    const summary = await syncManaged();
    const probe = safe.transport === "http" ? await probeHttpAuthRequirement(safe, secrets) : undefined;
    return { [method === "server.update" ? "updated" : "added"]: name, sync: summary, ...(probe?.authRequired ? { authRequired: true, authStatus: probe.status, oauthLikely: probe.oauthLikely, oauthSupport: probe.oauthSupport } : {}) };
  }
  if (method === "server.remove") {
    const [name] = z.tuple([string]).parse(raw);
    await mutateConfig(config => removeServer(config, name));
    clearOAuthCredentials(name, new SecretsManager());
    return { removed: name, sync: await syncManaged() };
  }
  if (method === "server.enabled") {
    const [name, enabled] = z.tuple([string, z.boolean()]).parse(raw);
    await mutateConfig(config => setServerEnabled(config, name, enabled));
    return { updated: name, enabled, sync: await syncManaged() };
  }
  if (method === "project.enabled") {
    const [projectPath, name, enabled] = z.tuple([string, string, z.boolean()]).parse(raw);
    const result = await mutateConfig(config => setProjectServerEnabled(config, projectPath, name, enabled));
    return { updated: name, enabled, ...result, sync: await syncManaged() };
  }
  if (method === "project.add" || method === "project.remove") {
    const [projectPath, name] = z.tuple([string, string.optional()]).parse(raw);
    await mutateConfig(config => method === "project.add" ? registerProject(config, projectPath, name) : unregisterProject(config, projectPath));
    return { success: true, sync: await syncManaged() };
  }
  if (method.startsWith("skill.")) {
    const skills = await import("./skills.js");
    const action = method.slice(6);
    const [id, value] = z.tuple([string, string.optional()]).parse(raw);
    let result: unknown;
    switch (action) {
      case "save": skills.saveSkill(id, string.parse(value)); result = { id, success: true }; break;
      case "delete": skills.deleteSkill(id); result = { id, success: true }; break;
      case "install": result = await skills.installSkillFromSource(id, value); break;
      case "customize": result = skills.customizeSkill(id, value); break;
      case "pin": skills.pinSkill(id); result = { id, success: true }; break;
      case "unpin": skills.unpinSkill(id); result = { id, success: true }; break;
      case "update": result = await skills.updateSkill(id); break;
      case "rollback": result = skills.rollbackSkill(id); break;
      default: throw new Error("Unknown skill operation");
    }
    await syncManaged();
    return result;
  }
  if (method.startsWith("plugin.")) {
    const plugins = await import("./plugin-manager.js");
    const [name, extra, value, project] = z.tuple([string.optional(), z.unknown().optional(), z.unknown().optional(), z.unknown().optional()]).parse(raw);
    const action = method.slice(7);
    const options = z.object({ name: string.optional(), enabled: z.boolean().optional(), components: z.record(z.string(), z.boolean()).optional(), approvals: z.record(z.string(), z.boolean()).optional() });
    switch (action) {
      case "install": return plugins.installPlugin(string.parse(name), options.optional().parse(extra) as any);
      case "prepare": await plugins.preparePlugin(string.parse(name)); break;
      case "update": return plugins.updatePlugin(string.parse(name));
      case "pin": await plugins.pinPlugin(string.parse(name)); break;
      case "unpin": await plugins.unpinPlugin(string.parse(name)); break;
      case "rollback": return plugins.rollbackPlugin(string.parse(name));
      case "uninstall": await plugins.uninstallPlugin(string.parse(name), z.object({ keepData: z.boolean().optional() }).optional().parse(extra)?.keepData); break;
      case "enable": await plugins.enablePlugin(string.parse(name)); break;
      case "disable": await plugins.disablePlugin(string.parse(name)); break;
      case "approve": await plugins.approvePluginComponent(string.parse(name), string.parse(extra)); break;
      case "project": await plugins.setPluginProjectOverride(string.parse(name), string.parse(extra), z.object({ enabled: z.boolean().optional(), components: z.record(z.string(), z.boolean()).optional() }).parse(value)); break;
      case "resetProject": await plugins.resetPluginProjectOverride(string.parse(name), string.parse(extra)); break;
      case "config": await plugins.pluginConfigSet(string.parse(name), string.parse(extra), string.parse(value), string.optional().parse(project)); break;
      case "sync": await plugins.pluginSync(); break;
      default: throw new Error("Unknown plugin operation");
    }
    return { name, success: true };
  }
  if (method.startsWith("marketplace.")) {
    const marketplaces = await import("./marketplace.js");
    const [name, extra] = z.tuple([string, z.unknown().optional()]).parse(raw);
    switch (method.slice(12)) {
      case "add": return marketplaces.addMarketplace(name, string.optional().parse(extra));
      case "refresh": return marketplaces.refreshMarketplaceWithPlugins(name);
      case "remove": await marketplaces.removeMarketplace(name); return { name, success: true };
      case "automatic": return marketplaces.setMarketplaceAutoUpdate(name, z.boolean().parse(extra));
      case "install": return marketplaces.installMarketplacePlugin(name);
    }
  }
  if (method === "share.import") {
    const [directory, options] = z.tuple([string, z.object({ locked: z.boolean().optional(), dryRun: z.boolean().optional(), inputs: z.record(z.string(), z.string()).optional() }).optional()]).parse(raw);
    const { importEnvironment } = await import("./share.js");
    const result = await importEnvironment(directory, options);
    if (!options?.dryRun) await syncManaged();
    return result;
  }
  throw new Error(`Unknown management method: ${method}`);
}
export type ManagementSnapshot = Awaited<ReturnType<typeof getManagementSnapshot>>;
export async function getManagementSnapshot() { return managementCommand("snapshot", []) as Promise<{ revision: number; capturedAt: string; harnesses: ReturnType<typeof listHarnesses>; operations: ReturnType<typeof listOperations>; servers: Array<{ name: string; transport: string; enabled: boolean; scope?: string }>; skills: Array<{ id: string; source?: string; readOnly?: boolean }>; packages: NonNullable<ReturnType<typeof loadConfig>["packages"]>[string][]; plugins: Array<{ id: string; name: string; version: string; status: string; enabled: boolean }> }>; }
