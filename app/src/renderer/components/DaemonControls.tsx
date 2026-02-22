interface DaemonControlsProps {
  daemon: { running: boolean; pid?: number; port?: number };
  onRefresh: () => void;
}

export function DaemonControls({ daemon, onRefresh }: DaemonControlsProps) {
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
        {daemon.running ? (
          <>
            <button className="btn btn-secondary" onClick={() => window.mcpx.daemonRestart().then(onRefresh)}>Restart</button>
            <button className="btn btn-danger" onClick={() => window.mcpx.daemonStop().then(onRefresh)}>Stop</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => window.mcpx.daemonStart().then(onRefresh)}>Start</button>
        )}
      </div>
    </div>
  );
}
