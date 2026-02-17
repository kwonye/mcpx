import { useStatus } from "../hooks/useMcpx";

export function StatusPopover(): JSX.Element {
  const { status, loading } = useStatus();

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

  const syncedCount = report.servers.reduce((count, server) => {
    return count + server.clients.filter((c) => c.managed && c.status === "SYNCED").length;
  }, 0);

  return (
    <div className="popover">
      <div className="popover-status">
        {report.daemon.running
          ? `Gateway running on :${report.daemon.port}`
          : "Gateway stopped"}
      </div>
      <div className="popover-summary">
        {report.upstreamCount} servers · {syncedCount} synced
        {errorCount > 0 && ` · ${errorCount} error${errorCount > 1 ? "s" : ""}`}
      </div>
      <div className="popover-actions">
        <button onClick={() => window.mcpx.openDashboard()}>Open Dashboard</button>
        <button onClick={() => window.mcpx.syncAll()}>Sync All</button>
        <button onClick={() => window.mcpx.daemonRestart()}>Restart</button>
      </div>
    </div>
  );
}
