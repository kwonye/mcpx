import { useEffect, useState } from "react";
import { Toggle } from "./ui";
import { useStatus } from "../hooks/useMcpx";
import { useServerEnabled } from "../hooks/useServerEnabled";
import { CompactCliInput } from "./CompactCliInput";
import { formatTokenApprox } from "../utils/tokenHelper";

interface PopoverServerRowProps {
  server: {
    name: string;
    enabled: boolean;
    transport?: string;
    authBindings?: Array<{ kind: string; key: string; value: string }>;
    tokenCount?: { tools: number; resources: number; prompts: number; total: number; error?: string };
  };
  onRefresh: () => void;
  onAuthClick?: () => void;
}

function PopoverServerRow({ server, onRefresh, onAuthClick }: PopoverServerRowProps) {
  const { isToggling, handleEnabledChange } = useServerEnabled(server.name, onRefresh);
  const authConfigured = (server.authBindings?.length ?? 0) > 0;

  return (
    <div className="popover-server-row">
      <div className="popover-server-row__meta">
        <div className="popover-server-row__title">
          <span className="popover-server-row__name">{server.name}</span>
          {server.enabled && server.tokenCount && server.tokenCount.total > 0 && (
            <span className="token-badge token-badge--compact" title={`${server.tokenCount.tools} tools, ${server.tokenCount.resources} resources, ${server.tokenCount.prompts} prompts`}>
              {formatTokenApprox(server.tokenCount.total)}
            </span>
          )}
          {server.enabled && server.tokenCount?.error && (
            <span className="token-badge token-badge--error token-badge--compact" title={server.tokenCount.error}>
              token error
            </span>
          )}
        </div>
        <span className={`popover-server-row__state ${server.enabled ? "is-enabled" : "is-disabled"}`}>
          {server.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {!authConfigured && server.transport === "http" && (
        <button
          type="button"
          className="popover-add-btn"
        title="Configure Auth"
        onClick={onAuthClick}
      >
        <span className="material-symbols-outlined">lock_open</span>
      </button>
      )}
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
  const [showAddServer, setShowAddServer] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<Array<{ serverName: string; oauthLikely?: boolean }>>([]);

  useEffect(() => {
    void window.mcpx.getPendingAuth?.().then((result: Array<{ serverName: string; oauthLikely?: boolean }> | null) => {
      setPendingAuth(result ?? []);
    }).catch(() => {
      setPendingAuth([]);
    });

    return window.mcpx.onAuthStateChanged?.((entries) => {
      setPendingAuth(entries);
    });
  }, []);

  if (loading || !status) {
    return <div className="popover">Loading...</div>;
  }

  const report = status;

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

  // The popover is 380x520 -- too small to host the full auth flow (OAuth
  // waiting panel, manual token form). It hands off to the one auth UI in the
  // dashboard instead of running its own; this also fixes auth state going
  // stale here, since the dashboard broadcast now reaches every window.
  function handleAuthClick(serverName: string): void {
    void window.mcpx.requestAuth?.(serverName);
  }

  function handleDismissAuth(serverName: string): void {
    void window.mcpx.dismissAuth(serverName);
  }

  return (
    <div className="popover">
      <header className="popover-header">
        <div className="popover-title-block">
          <div className="popover-title-row">
            <span className="popover-title">mcpx</span>
            <div className={`status-dot ${report.daemon.running ? 'status-online' : 'status-offline'}`} />
          </div>
          <span className="popover-subtitle">
            Gateway {report.daemon.running ? `Online (Port: ${report.daemon.port})` : "Offline"} • <span>{report.upstreamCount} Active</span>
            {report.daemon.running && typeof report.totalGlobalTokens === "number" && report.totalGlobalTokens > 0 && (
              <span> • {formatTokenApprox(report.totalGlobalTokens)} Tokens</span>
            )}
          </span>
        </div>
        <div className="popover-header-actions">
          <button type="button" onClick={handleDaemonToggle} className="popover-daemon-btn">
            {report.daemon.running ? "Stop" : "Start"}
          </button>
          <div className="popover-menu-wrap">
            <button
              type="button"
              className="popover-add-btn"
              title="More"
              aria-label="More"
              onClick={() => setShowMenu((value) => !value)}
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {showMenu && (
              <div className="popover-menu">
                <button type="button" onClick={() => window.mcpx.quitApp()}>
                  Quit mcpx
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="popover-main">
        {pendingAuth.length > 0 && (
          <section className="popover-section">
            {pendingAuth.map((entry) => (
              <div key={entry.serverName} className="popover-server-row popover-server-row--warning">
                <div className="popover-server-row__meta">
                  <span className="popover-server-row__name">
                    {entry.serverName}
                  </span>
                  <span className="popover-server-row__state">Auth required</span>
                </div>
                <button type="button" className="popover-add-btn" title="Open mcpx to sign in" onClick={() => handleAuthClick(entry.serverName)}>
                  <span className="material-symbols-outlined">login</span>
                </button>
                <button type="button" className="popover-add-btn" title="Dismiss" onClick={() => handleDismissAuth(entry.serverName)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            ))}
          </section>
        )}
        {report.servers.length > 0 ? (
          <section className="popover-section popover-section--fill">
            <div className="popover-section-header">
              <h2>
                Servers
              </h2>
              <button
                type="button"
                onClick={() => setShowAddServer(prev => !prev)}
                className="popover-add-btn"
                title="Add Server"
              >
                <span className="material-symbols-outlined">
                  {showAddServer ? "close" : "add"}
                </span>
              </button>
            </div>
            {showAddServer && <CompactCliInput onServerAdded={refresh} />}
            <div className="popover-server-list">
              {report.servers.map((server) => (
                <PopoverServerRow
                  key={server.name}
                  server={server}
                  onRefresh={refresh}
                  onAuthClick={() => handleAuthClick(server.name)}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="popover-section">
            <h2 className="popover-section-title">
              Add Your First Server
            </h2>
            <CompactCliInput onServerAdded={refresh} />
          </section>
        )}
      </main>

      <footer className="popover-actions">
        <button className="popover-btn primary" onClick={() => window.mcpx.openDashboard()}>
          <span>Open Dashboard</span>
          <span className="material-symbols-outlined">open_in_new</span>
        </button>
      </footer>
    </div>
  );
}
