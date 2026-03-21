import { useStatus } from "../hooks/useMcpx";

export function StatusPopover(): JSX.Element {
  const { status, loading, refresh } = useStatus();

  if (loading || !status) {
    return <div className="popover">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    upstreamCount: number;
    servers: Array<{ name: string; clients: Array<{ status: string; managed: boolean }> }>;
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
    <div className="popover">
      <div className="popover-header">
        <div className="popover-status-indicator" data-running={report.daemon.running ? "true" : "false"}></div>
        <div className="popover-status">
          {report.daemon.running
            ? `Gateway running on :${report.daemon.port}`
            : "Gateway stopped"}
        </div>
      </div>

      <div className="popover-summary">
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

      <div className="popover-actions">
        <button className="popover-btn primary" onClick={() => window.mcpx.openDashboard()}>
          Open Dashboard
        </button>
        <button className="popover-btn" onClick={() => window.mcpx.syncAll()}>
          Sync All Clients
        </button>
        <button className={`popover-btn ${report.daemon.running ? "" : "primary"}`} onClick={handleDaemonToggle}>
          {report.daemon.running ? "Stop Daemon" : "Start Daemon"}
        </button>
      </div>
    </div>
  );
}
