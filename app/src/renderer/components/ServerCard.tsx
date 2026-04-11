import { Toggle } from "./ui";
import { useServerEnabled } from "../hooks/useServerEnabled";

interface ServerCardProps {
  name: string;
  enabled: boolean;
  transport: string;
  target: string;
  authConfigured: boolean;
  syncedCount: number;
  errorCount: number;
  onRefresh: () => void;
  onClick: () => void;
}

export function ServerCard(props: ServerCardProps) {
  const isHealthy = props.enabled && props.errorCount === 0 && props.syncedCount > 0;
  const isWarning = props.enabled && props.errorCount > 0;
  const { isToggling, handleEnabledChange } = useServerEnabled(props.name, props.onRefresh);

  return (
    <div className="glass-card server-card" data-disabled={!props.enabled} onClick={props.onClick}>
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
                {isWarning ? `${props.errorCount} Errors` : props.enabled ? isHealthy ? 'Online' : 'Offline' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
        <div className="server-card__controls" onClick={(event) => event.stopPropagation()}>
          {props.authConfigured && (
            <div className="server-card__auth" title="Auth configured">
              <span className="material-symbols-outlined">lock</span>
            </div>
          )}
          <div className="server-card__toggle">
            <span className="server-card__toggle-state">{props.enabled ? "On" : "Off"}</span>
            <Toggle
              id={`server-card-enabled-${props.name}`}
              checked={props.enabled}
              disabled={isToggling}
              onChange={handleEnabledChange}
              label={`${props.enabled ? "Disable" : "Enable"} ${props.name}`}
            />
          </div>
        </div>
      </div>

      <div className="server-card__footer">
        <div className="server-card__meta">
          <span className="eyebrow">Target</span>
          <span className="server-card__target mono-text" title={props.target}>
            {props.target}
          </span>
        </div>
        <div className="server-card__meta server-card__meta--right">
          <span className="eyebrow">State</span>
          <span className="server-card__count">{props.enabled ? props.syncedCount : "Off"}</span>
        </div>
      </div>
    </div>
  );
}
