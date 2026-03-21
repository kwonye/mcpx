interface DaemonControlsProps {
  daemon: { running: boolean; pid?: number; port?: number };
  onRefresh: () => void;
}

export function DaemonControls({ daemon, onRefresh }: DaemonControlsProps) {
  function handleToggle(): void {
    if (daemon.running) {
      void window.mcpx.daemonStop().then(onRefresh);
      return;
    }

    void window.mcpx.daemonStart().then(onRefresh);
  }

  return (
    <div className="glass-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderRadius: "16px", marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div className={`status-dot ${daemon.running ? 'status-online' : 'status-offline'}`} style={{ width: "10px", height: "10px" }} />
        <div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-main)" }}>Local Gateway {daemon.running ? "Running" : "Stopped"}</div>
          {daemon.running && (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              PID {daemon.pid} • Port {daemon.port}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <button
          className={`btn ${daemon.running ? "btn-secondary" : "btn-primary"}`}
          style={daemon.running ? { color: "var(--error)", borderColor: "rgba(255, 59, 48, 0.2)" } : {}}
          onClick={handleToggle}
        >
          {daemon.running ? (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>stop_circle</span>
              Stop Daemon
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>play_circle</span>
              Start Daemon
            </>
          )}
        </button>
      </div>
    </div>
  );
}
