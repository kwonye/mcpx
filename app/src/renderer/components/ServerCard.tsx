interface ServerCardProps {
  name: string;
  transport: string;
  target: string;
  authConfigured: boolean;
  syncedCount: number;
  errorCount: number;
  onClick: () => void;
}

export function ServerCard(props: ServerCardProps): JSX.Element {
  return (
    <div className="server-card" onClick={props.onClick}>
      <div className="server-card-header">
        <span className="server-name">{props.name}</span>
        <span className="server-transport">{props.transport}</span>
        {props.authConfigured && <span className="server-auth-badge" title="Auth configured" />}
      </div>
      <div className="server-card-target">{props.target}</div>
      <div className="server-card-footer">
        <span>{props.syncedCount} synced</span>
        {props.errorCount > 0 && (
          <span className="server-error-count">
            {props.errorCount} error{props.errorCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
