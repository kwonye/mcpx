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
  const isHealthy = props.errorCount === 0 && props.syncedCount > 0;
  const isWarning = props.errorCount > 0;

  return (
    <div className="glass-card server-card" onClick={props.onClick}>
      <div className="server-card__header">
        <div className="server-card__main">
          <div className="server-card__icon">
            <span className="material-symbols-outlined">
              {props.transport === "http" ? "public" : "terminal"}
            </span>
          </div>
          <div className="server-card__body">
            <h3 className="server-card__title">{props.name}</h3>
            <div className="server-card__status">
              <div className={`status-dot ${isWarning ? 'status-error' : isHealthy ? 'status-online' : 'status-offline'}`}></div>
              <span>
                {isWarning ? `${props.errorCount} Errors` : isHealthy ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        {props.authConfigured && (
          <div className="server-card__auth" title="Auth configured">
            <span className="material-symbols-outlined">lock</span>
          </div>
        )}
      </div>

      <div className="server-card__footer">
        <div className="server-card__meta">
          <span className="eyebrow">Target</span>
          <span className="server-card__target mono-text" title={props.target}>
            {props.target}
          </span>
        </div>
        <div className="server-card__meta server-card__meta--right">
          <span className="eyebrow">Synced</span>
          <span className="server-card__count">{props.syncedCount}</span>
        </div>
      </div>
    </div>
  );
}
