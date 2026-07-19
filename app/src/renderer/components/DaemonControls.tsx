import { useState } from "react";

interface DaemonControlsProps {
  daemon: { running: boolean; pid?: number; port?: number };
  onRefresh: () => void;
}

export function DaemonControls({ daemon, onRefresh }: DaemonControlsProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(): Promise<void> {
    setError(null);
    try {
      if (daemon.running) {
        await window.mcpx.daemonStop();
      } else {
        await window.mcpx.daemonStart();
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${daemon.running ? "stop" : "start"} the gateway`);
    }
  }

  return (
    <div className="glass-panel daemon-panel">
      <div className="daemon-panel__info">
        <div className={`status-dot daemon-panel__indicator ${daemon.running ? "status-online" : "status-offline"}`} />
        <div>
          <div className="daemon-panel__title">Gateway {daemon.running ? "Running" : "Stopped"}</div>
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
            Stop
          </>
        ) : (
          <>
            <span className="material-symbols-outlined">play_circle</span>
            Start
          </>
        )}
      </button>
      {error && <div className="feedback-message error">{error}</div>}
    </div>
  );
}
