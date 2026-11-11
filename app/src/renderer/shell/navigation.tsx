import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DASHBOARD_ROUTES, type DashboardRoute } from "../../shared/ipc-channels";
import type { DesktopTab } from "../../shared/desktop-settings";
import type { TelemetryTab } from "../../shared/ipc-contract";
import { api } from "../lib/api";

export type Route = DashboardRoute;

export type Intent =
  | { type: "add-server" }
  | { type: "find-existing" }
  | { type: "sign-in"; serverName: string };

interface NavigationState {
  route: Route;
  /** Selected server (Servers detail page), if any. */
  serverName: string | null;
  /** Selected project (Projects detail), if any. */
  projectPath: string | null;
  intent: Intent | null;
  go: (route: Route) => void;
  openServer: (name: string | null) => void;
  openProject: (path: string | null) => void;
  request: (intent: Intent) => void;
  clearIntent: () => void;
}

const NavigationContext = createContext<NavigationState | null>(null);

/** Desktop settings persist the last tab; it predates Clients/Add-ons naming. */
const ROUTE_TO_TAB: Record<Route, DesktopTab> = { servers: "servers", clients: "harnesses", projects: "projects", addons: "plugins", settings: "settings" };
const TAB_TO_ROUTE: Record<string, Route> = { overview: "servers", servers: "servers", harnesses: "clients", activity: "clients", projects: "projects", plugins: "addons", skills: "addons", settings: "settings" };
const TELEMETRY_TABS: Partial<Record<Route, TelemetryTab>> = { servers: "servers", projects: "projects", addons: "plugins", settings: "settings" };

export function isRoute(value: string): value is Route {
  return (DASHBOARD_ROUTES as readonly string[]).includes(value);
}

/**
 * Parses what main sends on "navigate": a bare route ("clients"), or a route
 * with an intent the desktop app uses itself ("servers:add",
 * "servers:auth:<server>"). Unknown strings are ignored.
 */
export function parseNavigation(value: unknown): { route: Route; intent: Intent | null } | null {
  if (typeof value !== "string") return null;
  const [head, action, ...rest] = value.split(":");
  if (!isRoute(head)) return null;
  if (head === "servers" && action === "add") return { route: head, intent: { type: "add-server" } };
  if (head === "servers" && action === "auth" && rest.length > 0) return { route: head, intent: { type: "sign-in", serverName: rest.join(":") } };
  return { route: head, intent: null };
}

export function NavigationProvider({ children, initialRoute = "servers" }: { children: ReactNode; initialRoute?: Route }) {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [serverName, setServerName] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);

  const go = useCallback((next: Route) => {
    setRoute(next);
    setServerName(null);
    const telemetryTab = TELEMETRY_TABS[next];
    if (telemetryTab) void api().telemetry.captureTabViewed(telemetryTab).catch(() => {});
    void api().settings.update({ activeTab: ROUTE_TO_TAB[next] }).catch(() => {});
  }, []);

  // Restore the last tab once.
  useEffect(() => {
    let cancelled = false;
    void api().settings.get().then((settings) => {
      const restored = settings.activeTab ? TAB_TO_ROUTE[settings.activeTab] : undefined;
      if (!cancelled && restored) setRoute((current) => (current === initialRoute ? restored : current));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialRoute]);

  // Main-process navigation (menu items, tray, popover hand-offs).
  useEffect(() => api().app.onNavigate((raw) => {
    const parsed = parseNavigation(raw);
    if (!parsed) return;
    go(parsed.route);
    if (parsed.intent) setIntent(parsed.intent);
  }), [go]);

  const value = useMemo<NavigationState>(() => ({
    route,
    serverName,
    projectPath,
    intent,
    go,
    openServer: (name) => {
      setRoute("servers");
      setServerName(name);
    },
    openProject: (path) => setProjectPath(path),
    request: (next) => setIntent(next),
    clearIntent: () => setIntent(null)
  }), [route, serverName, projectPath, intent, go]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationState {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return context;
}
