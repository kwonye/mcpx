import { Toggle } from "./ui";
import { useStatus } from "../hooks/useMcpx";
import { useServerEnabled } from "../hooks/useServerEnabled";

interface PopoverServerRowProps {
  server: {
    name: string;
    enabled: boolean;
  };
  onRefresh: () => void;
}

function PopoverServerRow({ server, onRefresh }: PopoverServerRowProps) {
  const { isToggling, handleEnabledChange } = useServerEnabled(server.name, onRefresh);

  return (
    <div className="popover-server-row">
      <div className="popover-server-row__meta">
        <span className="popover-server-row__name">{server.name}</span>
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

  if (loading || !status) {
    return <div className="popover glass-panel">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    upstreamCount: number;
    servers: Array<{ name: string; enabled: boolean; clients: Array<{ clientId: string; status: string; managed: boolean }> }>;
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
      return;
    }

    void window.mcpx.daemonStart().then(() => refresh());
  }

  return (
    <div className="popover glass-panel">
      <header className="popover-header" style={{ justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.4)", paddingBottom: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.015em" }}>MCP Hub</span>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {report.upstreamCount} Active
          </span>
        </div>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", marginTop: "4px" }}>
        <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px" }}>
            Gateway Status
          </h2>
          <div className="glass-panel" style={{ padding: "12px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div className={`status-dot ${report.daemon.running ? 'status-online' : 'status-offline'}`} style={{ width: "10px", height: "10px" }} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>Local Gateway</span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {report.daemon.running ? `Port: ${report.daemon.port}` : "Offline"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h2 style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px" }}>
            System Health
          </h2>
          <div className="popover-summary glass-panel" style={{ border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="popover-summary-stat">
              <span>Configured Servers</span>
              <span className="value">{report.upstreamCount}</span>
            </div>
            <div className="popover-summary-stat">
              <span>Synced Clients</span>
              <span className="value">{syncedCount}</span>
            </div>
            <div className="popover-summary-stat">
              <span>Sync Errors</span>
              <span className={`value ${errorCount > 0 ? "error" : ""}`}>{errorCount}</span>
            </div>
          </div>
        </section>

        {report.servers.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: "8px", minHeight: 0 }}>
            <h2 style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px" }}>
              Servers
            </h2>
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
        )}
      </main>

      <footer className="popover-actions">
        <button className="popover-btn primary" onClick={() => window.mcpx.openDashboard()} style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
          <span>Open Dashboard</span>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>open_in_new</span>
        </button>
        <button className="popover-btn" onClick={handleDaemonToggle}>
          {report.daemon.running ? "Stop Gateway" : "Start Gateway"}
        </button>
      </footer>
    </div>
  );
}
