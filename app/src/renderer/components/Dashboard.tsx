import { useState } from "react";
import { useStatus } from "../hooks/useMcpx";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";
import { BrowseTab } from "./BrowseTab";
import { DaemonControls } from "./DaemonControls";
import { SettingsPanel } from "./SettingsPanel";
import { CliCommandInput } from "./CliCommandInput";

type Tab = "servers" | "browse" | "settings";

export function Dashboard() {
  const { status, loading, refresh } = useStatus();
  const [tab, setTab] = useState<Tab>("servers");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  if (loading || !status) {
    return (
      <div className="dashboard-container" style={{ alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
        Loading...
      </div>
    );
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    servers: Array<{
      name: string;
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
            <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>hub</span>
          </div>
          <span className="sidebar-logo-text">mcpx Manager</span>
        </div>
        <DaemonControls daemon={report.daemon} onRefresh={refresh} />
        <div className="sidebar-inner glass-panel">
          <button
            className="nav-button"
            data-active={tab === "servers"}
            onClick={() => { setTab("servers"); setSelectedServer(null); }}
          >
            <span className="material-symbols-outlined">grid_view</span>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>My Servers</span>
          </button>
          <button
            className="nav-button"
            data-active={tab === "browse"}
            onClick={() => { setTab("browse"); setSelectedServer(null); }}
          >
            <span className="material-symbols-outlined">explore</span>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>Browse Registry</span>
          </button>
          <div className="nav-spacer" />
          <button
            className="nav-button"
            data-active={tab === "settings"}
            onClick={() => { setTab("settings"); setSelectedServer(null); }}
          >
            <span className="material-symbols-outlined">settings</span>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>Settings</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
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
                <BrowseTab onServerAdded={refresh} status={report} />
              </>
            )}

            {tab === "settings" && (
              <>
                <div className="page-header">
                  <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-subtitle">Configure your mcpx installation.</p>
                  </div>
                </div>
                <SettingsPanel />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
