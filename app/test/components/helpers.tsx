import "@testing-library/jest-dom/vitest";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { ToastProvider } from "../../src/renderer/components/ui";
import { NavigationProvider } from "../../src/renderer/shell/navigation";
import { resetQueryCache } from "../../src/renderer/lib/query";
import { resetPendingAuthStore } from "../../src/renderer/hooks/usePendingAuth";

export function server(name: string, overrides: Record<string, unknown> = {}) {
  const spec = (overrides.spec as Record<string, unknown>) ?? { transport: "http", url: `https://${name}.example.com/mcp` };
  return {
    name,
    enabled: true,
    transport: spec.transport,
    target: spec.transport === "http" ? spec.url : spec.command,
    spec,
    authBindings: [],
    clients: [
      { clientId: "claude", managed: true, status: "SYNCED" },
      { clientId: "cursor", managed: true, status: "SYNCED" },
      { clientId: "kiro", managed: false, status: "SKIPPED" }
    ],
    ...overrides
  };
}

export function statusReport(overrides: Record<string, unknown> = {}) {
  return {
    gatewayUrl: "http://127.0.0.1:37373/mcp",
    daemon: { running: true, pid: 4242, port: 37373, pidFile: "", logFile: "/tmp/daemon.log" },
    upstreamCount: 0,
    servers: [],
    clients: {},
    projects: {},
    ...overrides
  };
}

export const telemetryStatus = (acknowledged = true) => ({
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

const sync = { gatewayUrl: "", imports: {}, results: [], hasErrors: false };

/** A complete window.mcpx with harmless defaults; override per test. */
export function createApi() {
  const api = {
    platform: "darwin",
    app: {
      openDashboard: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      onNavigate: vi.fn(() => () => {}),
      selectDirectory: vi.fn(async () => "/Users/ana/src/api"),
      checkForUpdates: vi.fn(async () => ({ status: "up-to-date", message: "You're on the latest version." }))
    },
    status: {
      get: vi.fn(async () => statusReport()),
      tokenCounts: vi.fn(async () => ({ gatewayRunning: true, counts: {}, totalGlobalTokens: 0, totalProjectTokens: {} })),
      syncAll: vi.fn(async () => sync)
    },
    gateway: { start: vi.fn(async () => ({ started: true, pid: 1, port: 1, message: "" })), stop: vi.fn(async () => ({ stopped: true, message: "" })), restart: vi.fn(async () => ({ started: true, pid: 1, port: 1, message: "" })) },
    management: {
      snapshot: vi.fn(async () => ({ revision: 1, capturedAt: new Date().toISOString(), harnesses: [], operations: [], servers: [], skills: [], packages: [], plugins: [] })),
      planAdoption: vi.fn(async () => ({ id: "plan", createdAt: "", configHash: "", items: [], errors: [] })),
      applyAdoption: vi.fn(async () => ({})),
      rollback: vi.fn(async () => ({})),
      setHarnessMode: vi.fn(async () => ({})),
      onChange: vi.fn(() => () => {})
    },
    secrets: { backend: vi.fn(async () => "file"), setBackend: vi.fn(async () => ({ backend: "keychain", changed: true, migrated: ["a"], preserved: [] })) },
    settings: {
      get: vi.fn(async () => ({ autoUpdateEnabled: true, startOnLoginEnabled: true, errorNotificationsEnabled: true, activeTab: "servers" })),
      update: vi.fn(async (patch: object) => ({ autoUpdateEnabled: true, startOnLoginEnabled: true, errorNotificationsEnabled: true, ...patch }))
    },
    telemetry: {
      status: vi.fn(async () => telemetryStatus(true)),
      acknowledge: vi.fn(async () => ({})),
      updatePreferences: vi.fn(async () => ({})),
      resetId: vi.fn(async () => ({})),
      captureTabViewed: vi.fn(async () => undefined),
      onChanged: vi.fn(() => () => {})
    },
    servers: {
      parseInput: vi.fn(async () => ({ kind: "url", name: "linear", spec: { transport: "http", url: "https://mcp.linear.app/mcp" } })),
      add: vi.fn(async () => ({ added: "linear", sync })),
      update: vi.fn(async () => ({ updated: "x", sync })),
      remove: vi.fn(async () => ({ removed: "x", sync })),
      setEnabled: vi.fn(async () => ({ updated: "x", enabled: true, sync }))
    },
    auth: {
      configure: vi.fn(async () => ({ configured: true, sync })),
      pending: vi.fn(async () => []),
      onPendingChanged: vi.fn(() => () => {}),
      request: vi.fn(async () => ({ opened: true })),
      dismiss: vi.fn(async () => ({ dismissed: "x" })),
      checkOAuthSupport: vi.fn(async () => ({ support: "supported" })),
      startOAuth: vi.fn(async () => ({ serverName: "x", authorized: true })),
      cancelOAuth: vi.fn(async () => ({ cancelled: true })),
      reopenOAuth: vi.fn(async () => ({ reopened: true })),
      onOAuthProgress: vi.fn(() => () => {})
    },
    projects: { add: vi.fn(async () => ({ success: true, sync })), remove: vi.fn(async () => ({ success: true, sync })), setServerEnabled: vi.fn(async () => ({})) },
    skills: {
      list: vi.fn(async () => []), save: vi.fn(async () => ({ id: "x", success: true })), delete: vi.fn(async () => ({ id: "x", success: true })),
      install: vi.fn(async () => ({ id: "installed", content: "" })), customize: vi.fn(async () => ({ id: "copy", content: "" })),
      pin: vi.fn(async () => ({})), unpin: vi.fn(async () => ({})), update: vi.fn(async () => ({ id: "x", content: "" })), rollback: vi.fn(async () => ({ id: "x", content: "" }))
    },
    share: {
      export: vi.fn(async () => ({ environment: { servers: {}, skills: [], plugins: [], inputs: [] }, lock: {} })),
      import: vi.fn(async () => ({ importedSkills: [], importedPlugins: [], importedServers: [], missingInputs: [] }))
    },
    plugins: {
      list: vi.fn(async () => []), install: vi.fn(async () => ({ name: "p", version: "1.0.0" })), update: vi.fn(async () => ({ version: "1.0.0" })),
      pin: vi.fn(async () => ({})), unpin: vi.fn(async () => ({})), rollback: vi.fn(async () => ({ version: "0.9.0" })), uninstall: vi.fn(async () => ({})),
      enable: vi.fn(async () => ({})), disable: vi.fn(async () => ({})), approve: vi.fn(async () => ({})), setProjectOverride: vi.fn(async () => ({})), resetProjectOverride: vi.fn(async () => ({}))
    },
    marketplaces: {
      list: vi.fn(async () => []), add: vi.fn(async () => ({ displayName: "Team" })), refresh: vi.fn(async () => ({ updated: [], errors: [] })), remove: vi.fn(async () => ({})),
      setAutoUpdate: vi.fn(async () => ({})), browse: vi.fn(async () => []), inspect: vi.fn(async () => ({})), install: vi.fn(async () => ({ name: "p" }))
    }
  };
  return api as typeof api & Record<string, unknown>;
}

export type TestApi = ReturnType<typeof createApi>;

/** Installs a fresh API and clears shared caches. Call in beforeEach. */
export function installApi(overrides?: (api: TestApi) => void): TestApi {
  resetQueryCache();
  resetPendingAuthStore();
  const api = createApi();
  overrides?.(api);
  Object.defineProperty(window, "mcpx", { value: api, writable: true, configurable: true });
  return api;
}

export function renderWithProviders(ui: ReactElement, { navigation = true } = {}): RenderResult {
  return render(<ToastProvider>{navigation ? <NavigationProvider>{ui}</NavigationProvider> : ui}</ToastProvider>);
}
