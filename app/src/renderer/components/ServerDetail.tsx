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

export function ServerDetail({ server, onBack, onRefresh }: ServerDetailProps): JSX.Element {
  return (
    <div className="server-detail">
      <button onClick={onBack}>Back</button>
      <h2>{server.name}</h2>
      <div className="server-detail-info">
        <div>Transport: {server.transport}</div>
        <div>Target: {server.target}</div>
      </div>
      <div className="server-detail-auth">
        <h3>Auth Bindings</h3>
        {server.authBindings.length === 0 ? (
          <p>No auth configured</p>
        ) : (
          <ul>
            {server.authBindings.map((binding, i) => (
              <li key={i}>{binding.kind}: {binding.key}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="server-detail-clients">
        <h3>Client Sync Status</h3>
        <table>
          <thead>
            <tr><th>Client</th><th>Status</th></tr>
          </thead>
          <tbody>
            {server.clients.map((client) => (
              <tr key={client.clientId}>
                <td>{client.clientId}</td>
                <td>{client.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="server-detail-actions">
        <button onClick={() => window.mcpx.removeServer(server.name).then(onRefresh)}>
          Remove Server
        </button>
      </div>
    </div>
  );
}
