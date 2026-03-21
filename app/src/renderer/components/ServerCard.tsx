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
    <div className="glass-card" onClick={props.onClick} style={{ padding: "20px", display: "flex", flexDirection: "column", height: "160px", cursor: "pointer", position: "relative", overflow: "hidden", borderRadius: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          <div style={{ width: "40px", height: "40px", flexShrink: 0, borderRadius: "12px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-main)", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>
              {props.transport === "http" ? "public" : "terminal"}
            </span>
          </div>
          <div style={{ overflow: "hidden" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-main)", lineHeight: "1.2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.name}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
              <div className={`status-dot ${isWarning ? 'status-error' : isHealthy ? 'status-online' : 'status-offline'}`}></div>
              <span style={{ color: "var(--text-muted)", fontSize: "12px", fontWeight: 500 }}>
                {isWarning ? `${props.errorCount} Errors` : isHealthy ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
        {props.authConfigured && (
          <div style={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "50%", background: "rgba(83, 80, 241, 0.1)", color: "var(--primary)", marginLeft: "8px" }} title="Auth configured">
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>lock</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", paddingRight: "8px", flex: 1 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: "4px" }}>
            Target
          </span>
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "12px", color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={props.target}>
            {props.target}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: "4px" }}>
            Synced
          </span>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-main)" }}>
            {props.syncedCount}
          </span>
        </div>
      </div>
    </div>
  );
}
