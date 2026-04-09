import { useState, useEffect } from "react";
import { useStatus } from "../hooks/useMcpx";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";
import { BrowseTab } from "./BrowseTab";
import { DaemonControls } from "./DaemonControls";
import { SettingsPanel } from "./SettingsPanel";
import { CliCommandInput } from "./CliCommandInput";
import type { BrowseState } from "../../shared/desktop-settings";
import { DESKTOP_MANAGER_NAME, DESKTOP_PRODUCT_NAME } from "../../shared/build-constants";

type Tab = "servers" | "browse" | "settings";

export function Dashboard() {
  const { status, loading, refresh } = useStatus();
  const [tab, setTab] = useState<Tab>("servers");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [browseState, setBrowseState] = useState<BrowseState>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load settings on mount to restore persisted state
  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await window.mcpx.getDesktopSettings();
        if (settings.browseState?.activeTab) {
          setTab(settings.browseState.activeTab as Tab);
        }
        setBrowseState(settings.browseState ?? {});
      } catch {
        // Use defaults if settings fail to load
      }
      setSettingsLoaded(true);
    }
    loadSettings();
  }, []);

  // Persist tab changes to settings
  const handleTabChange = async (newTab: Tab) => {
    setTab(newTab);
    setSelectedServer(null);
    const newBrowseState = { ...browseState, activeTab: newTab };
    setBrowseState(newBrowseState);
    try {
      await window.mcpx.updateDesktopSettings({ browseState: newBrowseState });
    } catch {
      // Ignore persistence errors
    }
  };

  // Handle browse state changes from BrowseTab
  const handleBrowseStateChange = async (state: { searchQuery?: string; activeCategory?: string }) => {
    const newBrowseState = { ...browseState, ...state, activeTab: "browse" as const };
    setBrowseState(newBrowseState);
    try {
      await window.mcpx.updateDesktopSettings({ browseState: newBrowseState });
    } catch {
      // Ignore persistence errors
    }
  };

  if (loading || !status || !settingsLoaded) {
    return (
      <div className="dashboard-container dashboard-loading">
        Loading...
      </div>
    );
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    servers: Array<{
      name: string;
      enabled: boolean;
      transport: string;
      target: string;
      authBindings: Array<{ kind: string; key: string; value: string }>;
      clients: Array<{ clientId: string; status: string; managed: boolean }>;
    }>;
  };

  const activeServer = selectedServer ? report.servers.find((s) => s.name === selectedServer) : null;

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <span className="material-symbols-outlined">hub</span>
          </div>
          <span className="sidebar-logo-text">{DESKTOP_MANAGER_NAME}</span>
        </div>
        <DaemonControls daemon={report.daemon} onRefresh={refresh} />
        <div className="sidebar-inner glass-panel">
          <button
            className="nav-button"
            data-active={tab === "servers"}
            onClick={() => handleTabChange("servers")}
          >
            <span className="material-symbols-outlined">grid_view</span>
            <span className="nav-button__label">My Servers</span>
          </button>
          <button
            className="nav-button"
            data-active={tab === "browse"}
            onClick={() => handleTabChange("browse")}
          >
            <span className="material-symbols-outlined">explore</span>
            <span className="nav-button__label">Browse Registry</span>
          </button>
          <div className="nav-spacer" />
          <button
            className="nav-button"
            data-active={tab === "settings"}
            onClick={() => handleTabChange("settings")}
          >
            <span className="material-symbols-outlined">settings</span>
            <span className="nav-button__label">Settings</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-content-inner">
          {activeServer ? (
            <ServerDetail
              server={activeServer}
              onBack={() => setSelectedServer(null)}
              onRefresh={refresh}
            />
          ) : (
            <>
              {tab === "servers" && (
                <>
                  <div className="page-header">
                    <div>
                      <h1 className="page-title">My Servers</h1>
                      <p className="page-subtitle">Manage your local and remote MCP integrations.</p>
                    </div>
                  </div>
                  <div className="servers-controls-container">
                    <CliCommandInput onServerAdded={refresh} />
                  </div>
                  <div className="server-grid">
                    {report.servers.map((server) => (
                      <ServerCard
                        key={server.name}
                        name={server.name}
                        enabled={server.enabled}
                        transport={server.transport}
                        target={server.target}
                        authConfigured={server.authBindings.length > 0}
                        syncedCount={server.clients.filter((c) => c.managed && c.status === "SYNCED").length}
                        errorCount={server.clients.filter((c) => c.managed && c.status === "ERROR").length}
                        onClick={() => setSelectedServer(server.name)}
                      />
                    ))}
                  </div>
                </>
              )}

              {tab === "browse" && (
                <>
                  <div className="page-header">
                    <div>
                      <h1 className="page-title">Registry</h1>
                      <p className="page-subtitle">Discover and install official MCP servers.</p>
                    </div>
                  </div>
                  <BrowseTab
                    onServerAdded={refresh}
                    status={report}
                    initialState={{
                      searchQuery: browseState.searchQuery,
                      activeCategory: browseState.activeCategory
                    }}
                    onStateChange={handleBrowseStateChange}
                  />
                </>
              )}

              {tab === "settings" && (
                <>
                  <div className="page-header">
                    <div>
                      <h1 className="page-title">Settings</h1>
                      <p className="page-subtitle">Configure your {DESKTOP_PRODUCT_NAME} installation.</p>
                    </div>
                  </div>
                  <SettingsPanel />
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
