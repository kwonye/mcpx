interface DaemonControlsProps {
  daemon: { running: boolean; pid?: number; port?: number };
  onRefresh: () => void;
}

export function DaemonControls({ daemon, onRefresh }: DaemonControlsProps): JSX.Element {
  return (
    <div className="daemon-controls">
      <div className="daemon-status">
        {daemon.running
          ? `Daemon running (PID ${daemon.pid}, port ${daemon.port})`
          : "Daemon stopped"}
      </div>
      <div className="daemon-actions">
        {daemon.running ? (
          <>
            <button onClick={() => window.mcpx.daemonStop().then(onRefresh)}>Stop</button>
            <button onClick={() => window.mcpx.daemonRestart().then(onRefresh)}>Restart</button>
          </>
        ) : (
          <button onClick={() => window.mcpx.daemonStart().then(onRefresh)}>Start</button>
        )}
      </div>
    </div>
  );
}
