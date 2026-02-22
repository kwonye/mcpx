interface ServerDetailProps {
  server: {
    name: string;
    transport: string;
    target: string;
    authBindings: Array<{ kind: string; key: string; value: string }>;
    clients: Array<{ clientId: string; status: string; managed: boolean }>;
  };
  onBack: () => void;
  onRefresh: () => void;
}

export function ServerDetail({ server, onBack, onRefresh }: ServerDetailProps) {
  return (
    <div className="server-detail">
      <div className="server-detail-header">
        <button className="server-detail-back" onClick={onBack} title="Back">
          ←
        </button>
        <h2 className="server-detail-title">{server.name}</h2>
      </div>

      <div className="detail-section">
        <h3>Configuration</h3>
        <div className="info-grid">
          <div className="info-label">Transport</div>
          <div className="info-value">{server.transport}</div>
          <div className="info-label">Target</div>
          <div className="info-value">{server.target}</div>
        </div>
      </div>

      <div className="detail-section">
        <h3>Auth Bindings</h3>
        {server.authBindings.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>No auth configured</p>
        ) : (
          <ul className="auth-list">
            {server.authBindings.map((binding, i) => (
              <li key={i} className="auth-item">
                <span className="auth-kind">{binding.kind}</span>
                <span className="info-value">{binding.key}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-section">
        <h3>Client Sync Status</h3>
        {server.clients.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>No clients synced.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr><th>Client</th><th>Status</th></tr>
            </thead>
            <tbody>
              {server.clients.map((client) => (
                <tr key={client.clientId}>
                  <td>{client.clientId}</td>
                  <td>
                    <span className={client.status === "SYNCED" ? "server-card-status-ok" : "server-card-status-error"}>
                      {client.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="detail-section" style={{ border: "1px solid rgba(239, 68, 68, 0.2)" }}>
        <h3 style={{ color: "var(--error)", borderBottomColor: "rgba(239, 68, 68, 0.2)" }}>Danger Zone</h3>
        <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>Removing this server will disconnect it from all synced clients.</p>
        <button className="btn btn-danger" onClick={() => window.mcpx.removeServer(server.name).then(onRefresh)}>
          Remove Server
        </button>
      </div>
    </div>
  );
}
