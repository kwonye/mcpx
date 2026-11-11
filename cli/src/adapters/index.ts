import type { ClientAdapter, ClientId, HarnessDescriptor } from "../types.js";
import { CLIENT_CATALOGUE } from "./catalogue.js";
import { CatalogueAdapter } from "./generic.js";
import { currentHost, type HostContext } from "./host.js";

export { CLIENT_CATALOGUE, CLIENT_IDS, getClientDefinition } from "./catalogue.js";
export type { ClientDefinition } from "./catalogue.js";
export { CatalogueAdapter } from "./generic.js";
export { currentHost } from "./host.js";
export type { HostContext } from "./host.js";

interface Registration { factory: () => ClientAdapter; descriptor: HarnessDescriptor }
const registrations = new Map<string, Registration>();

/**
 * Register an extra harness that the data-driven catalogue does not describe.
 * Catalogued clients are built from `CLIENT_CATALOGUE`; this is only an extension point.
 */
export function registerHarness(id: string, factory: () => ClientAdapter, descriptor: HarnessDescriptor = {}): void {
  if (registrations.has(id) || CLIENT_CATALOGUE.some((client) => client.id === id)) throw new Error(`Harness already registered: ${id}`);
  registrations.set(id, { factory, descriptor });
}

/** One adapter per catalogued client (plus registered extras). `host` defaults to the running machine. */
export function getAdapters(host: Partial<HostContext> = {}): ClientAdapter[] {
  const ctx = currentHost(host);
  return [
    ...CLIENT_CATALOGUE.map((def) => new CatalogueAdapter(def, ctx)),
    ...Array.from(registrations.values(), ({ factory, descriptor }) => Object.assign(factory(), { descriptor }))
  ];
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
