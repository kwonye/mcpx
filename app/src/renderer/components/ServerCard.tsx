interface ServerCardProps {
  name: string;
  transport: string;
  target: string;
  authConfigured: boolean;
  syncedCount: number;
  errorCount: number;
  onClick: () => void;
}

export function ServerCard(props: ServerCardProps) {
  return (
    <div className="server-card" onClick={props.onClick}>
      <div className="server-card-header">
        <span className="server-card-name">{props.name}</span>
        <span className="server-card-transport">{props.transport}</span>
        {props.authConfigured && (
          <span className="server-auth-badge" title="Auth configured">
            🔒
          </span>
        )}
      </div>
      <div className="server-card-target">{props.target}</div>
      <div className="server-card-footer">
        <span className={props.syncedCount > 0 ? "server-card-status-ok" : ""}>
          {props.syncedCount} synced
        </span>
        {props.errorCount > 0 && (
          <span className="server-card-status-error">
            {props.errorCount} error{props.errorCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
