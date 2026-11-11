import type { ClientAdapter, ClientId } from "../types.js";
import { CLIENT_CATALOGUE } from "./catalogue.js";
import { CatalogueAdapter } from "./generic.js";
import { currentHost, type HostContext } from "./host.js";

export { CLIENT_CATALOGUE, CLIENT_IDS, getClientDefinition } from "./catalogue.js";
export type { ClientDefinition } from "./catalogue.js";
export { CatalogueAdapter } from "./generic.js";
export { currentHost } from "./host.js";
export type { HostContext } from "./host.js";

/** One adapter per catalogued client. `host` defaults to the running machine. */
export function getAdapters(host: Partial<HostContext> = {}): ClientAdapter[] {
  const ctx = currentHost(host);
  return CLIENT_CATALOGUE.map((def) => new CatalogueAdapter(def, ctx));
}

export function getAdapter(id: ClientId, host: Partial<HostContext> = {}): ClientAdapter | undefined {
  return getAdapters(host).find((adapter) => adapter.id === id);
}

/** Ids of clients that look installed (config file/dir, app bundle or binary on PATH). */
export function detectInstalledClients(host: Partial<HostContext> = {}): ClientId[] {
  return getAdapters(host)
    .filter((adapter) => adapter.detectInstallation?.().installed ?? true)
    .map((adapter) => adapter.id);
}
