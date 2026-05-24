import { useState } from "react";
import { Toggle } from "./ui";
import { useStatus } from "../hooks/useMcpx";
import { useServerEnabled } from "../hooks/useServerEnabled";
import { CompactCliInput } from "./CompactCliInput";
import { formatTokenApprox } from "../utils/tokenHelper";

interface PopoverServerRowProps {
  server: {
    name: string;
    enabled: boolean;
    tokenCount?: { tools: number; resources: number; prompts: number; total: number };
  };
  onRefresh: () => void;
}

function PopoverServerRow({ server, onRefresh }: PopoverServerRowProps) {
  const { isToggling, handleEnabledChange } = useServerEnabled(server.name, onRefresh);

  return (
    <div className="popover-server-row">
      <div className="popover-server-row__meta" style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span className="popover-server-row__name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.name}</span>
          {server.enabled && server.tokenCount && server.tokenCount.total > 0 && (
            <span className="token-badge" title={`${server.tokenCount.tools} tools, ${server.tokenCount.resources} resources, ${server.tokenCount.prompts} prompts`} style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}>
              {formatTokenApprox(server.tokenCount.total)}
            </span>
          )}
        </div>
        <span className={`popover-server-row__state ${server.enabled ? "is-enabled" : "is-disabled"}`}>
          {server.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <Toggle
        id={`popover-server-enabled-${server.name}`}
        checked={server.enabled}
        disabled={isToggling}
        onChange={handleEnabledChange}
        label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
      />
    </div>
  );
}

export function StatusPopover() {
  const { status, loading, refresh } = useStatus();
  const [showAddServer, setShowAddServer] = useState(false);

  if (loading || !status) {
    return <div className="popover glass-panel">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    upstreamCount: number;
    servers: Array<{
      name: string;
      enabled: boolean;
      clients: Array<{ clientId: string; status: string; managed: boolean }>;
      tokenCount?: { tools: number; resources: number; prompts: number; total: number };
    }>;
    totalGlobalTokens?: number;
  };

  const errorCount = report.servers.reduce((count, server) => {
    return count + server.clients.filter((c) => c.managed && c.status === "ERROR").length;
  }, 0);

  const syncedClients = new Set<string>();
  report.servers.forEach((server) => {
    server.clients.forEach((c) => {
      if (c.managed && c.status === "SYNCED") {
        syncedClients.add(c.clientId);
      }
    });
  });
  const syncedCount = syncedClients.size;

  function handleDaemonToggle(): void {
    if (report.daemon.running) {
      void window.mcpx.daemonStop().then(() => refresh());
    } else {
      void window.mcpx.daemonStart().then(() => refresh());
    }
  }

  return (
    <div className="popover glass-panel">
      <header className="popover-header" style={{ justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.4)", paddingBottom: "12px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.015em" }}>mcpx</span>
            <div className={`status-dot ${report.daemon.running ? 'status-online' : 'status-offline'}`} style={{ width: "8px", height: "8px" }} />
          </div>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>
            Gateway {report.daemon.running ? `Online (Port: ${report.daemon.port})` : "Offline"} • <span>{report.upstreamCount} Active</span>
            {report.daemon.running && typeof report.totalGlobalTokens === "number" && report.totalGlobalTokens > 0 && (
              <span> • {formatTokenApprox(report.totalGlobalTokens)} Tokens</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDaemonToggle}
          style={{
            padding: "4px 12px",
            fontSize: "11px",
            fontWeight: 600,
            borderRadius: "6px",
            border: "1px solid var(--primary)",
            backgroundColor: "var(--primary)",
            color: "white",
            cursor: "pointer",
          }}
        >
          {report.daemon.running ? "Stop" : "Start"}
        </button>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px", overflow: "auto", minHeight: 0 }}>
        {report.servers.length > 0 ? (
          <section style={{ display: "flex", flexDirection: "column", gap: "8px", minHeight: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
              <h2 style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Servers
              </h2>
              <button
                type="button"
                onClick={() => setShowAddServer(prev => !prev)}
                className="popover-add-btn"
                title="Add Server"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                  {showAddServer ? "close" : "add"}
                </span>
              </button>
            </div>
            {showAddServer && <CompactCliInput onServerAdded={refresh} />}
            <div className="popover-server-list glass-panel">
              {report.servers.map((server) => (
                <PopoverServerRow
                  key={server.name}
                  server={server}
                  onRefresh={refresh}
                />
              ))}
            </div>
          </section>
        ) : (
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2 style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px" }}>
              Add Your First Server
            </h2>
            <CompactCliInput onServerAdded={refresh} />
          </section>
        )}
      </main>

      <footer className="popover-actions">
        <button className="popover-btn primary" onClick={() => window.mcpx.openDashboard()} style={{ display: "flex", justifyContent: "center", gap: "8px", width: "100%" }}>
          <span>Open Dashboard</span>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>open_in_new</span>
        </button>
      </footer>
    </div>
  );
}
