import { ipcMain } from "electron";
import {
  loadConfig,
  saveConfig,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  syncAllClients,
  addServer,
  removeServer,
  loadManagedIndex,
  listAuthBindings,
  SecretsManager
} from "@mcpx/core";
import type { UpstreamServerSpec } from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";
import { openDashboard } from "./dashboard";
import { fetchRegistryServers, fetchServerDetail } from "./registry-client";
import { selectBestPackage, extractRequiredInputs, mapServerToSpec } from "./server-mapper";
import type { SelectedOption } from "./server-mapper";

// Cache the selected option between prepare and confirm calls
let pendingAdd: { name: string; option: SelectedOption } | null = null;

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.OPEN_DASHBOARD, () => {
    openDashboard();
  });

  ipcMain.handle(IPC.GET_STATUS, () => {
    const config = loadConfig();
    const daemon = getDaemonStatus(config);
    const servers = Object.entries(config.servers).map(([name, spec]) => {
      const transport = spec.transport;
      const target = transport === "http" ? spec.url : `${spec.command} ${(spec.args ?? []).join(" ")}`;
      const authBindings = listAuthBindings(spec);
      const clientStatuses = Object.entries(config.clients).map(([clientId, state]) => ({
        clientId,
        status: state?.status ?? "SKIPPED",
        managed: true
      }));
      return { name, transport, target, authBindings, clients: clientStatuses };
    });
    return {
      daemon,
      upstreamCount: Object.keys(config.servers).length,
      servers
    };
  });

  ipcMain.handle(IPC.GET_SERVERS, () => {
    const config = loadConfig();
    return Object.entries(config.servers).map(([name, spec]) => ({ name, ...spec }));
  });

  ipcMain.handle(IPC.ADD_SERVER, (_event, name: string, spec: UpstreamServerSpec) => {
    const config = loadConfig();
    addServer(config, name, spec, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { added: name, sync: summary };
  });

  ipcMain.handle(IPC.REMOVE_SERVER, (_event, name: string) => {
    const config = loadConfig();
    removeServer(config, name, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { removed: name, sync: summary };
  });

  ipcMain.handle(IPC.SYNC_ALL, () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return syncAllClients(config, secrets);
  });

  ipcMain.handle(IPC.DAEMON_START, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return startDaemon(config, process.execPath, secrets);
  });

  ipcMain.handle(IPC.DAEMON_STOP, () => {
    return stopDaemon();
  });

  ipcMain.handle(IPC.DAEMON_RESTART, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return restartDaemon(config, process.execPath, secrets);
  });

  ipcMain.handle(IPC.REGISTRY_LIST, (_event, cursor?: string, query?: string) => {
    return fetchRegistryServers(cursor, query);
  });

  ipcMain.handle(IPC.REGISTRY_GET, (_event, name: string) => {
    return fetchServerDetail(name);
  });

  ipcMain.handle(IPC.REGISTRY_PREPARE_ADD, async (_event, registryName: string) => {
    const detail = await fetchServerDetail(registryName);
    const option = selectBestPackage(detail.server.packages, detail.server.remotes);
    const requiredInputs = extractRequiredInputs(option);
    // Derive a short local name from the registry name
    const shortName = registryName.split("/").pop() ?? registryName;
    pendingAdd = { name: shortName, option };
    return { shortName, requiredInputs, option };
  });

  ipcMain.handle(IPC.REGISTRY_CONFIRM_ADD, (_event, resolvedValues: Record<string, string>) => {
    if (!pendingAdd) throw new Error("No pending add operation");
    const { name, option } = pendingAdd;
    pendingAdd = null;
    const spec = mapServerToSpec(name, option, resolvedValues);
    const config = loadConfig();
    addServer(config, name, spec, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { added: name, sync: summary };
  });
}
