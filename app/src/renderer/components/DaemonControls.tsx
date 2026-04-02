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
    <div className="glass-panel daemon-panel">
      <div className="daemon-panel__info">
        <div className={`status-dot daemon-panel__indicator ${daemon.running ? "status-online" : "status-offline"}`} />
        <div>
          <div className="daemon-panel__title">Local Gateway {daemon.running ? "Running" : "Stopped"}</div>
          {daemon.running && (
            <div className="daemon-panel__meta">
              PID {daemon.pid} • Port {daemon.port}
            </div>
          )}
        </div>
      </div>
      <button
        className={`btn ${daemon.running ? "btn-secondary btn-stop" : "btn-primary"}`}
        onClick={handleToggle}
      >
        {daemon.running ? (
          <>
            <span className="material-symbols-outlined">stop_circle</span>
            Stop Gateway
          </>
        ) : (
          <>
            <span className="material-symbols-outlined">play_circle</span>
            Start Gateway
          </>
        )}
      </button>
    </div>
  );
}
