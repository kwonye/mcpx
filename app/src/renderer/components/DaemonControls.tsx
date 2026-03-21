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
    <div className="daemon-controls">
      <div className="daemon-status">
        <div className="daemon-indicator" data-running={daemon.running} />
        <div>
          <div>Daemon {daemon.running ? "Running" : "Stopped"}</div>
          {daemon.running && (
            <div className="daemon-status-text">PID {daemon.pid} • Port {daemon.port}</div>
          )}
        </div>
      </div>
      <div className="daemon-actions">
        <button
          className={`btn ${daemon.running ? "btn-danger" : "btn-primary"}`}
          onClick={handleToggle}
        >
          {daemon.running ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
