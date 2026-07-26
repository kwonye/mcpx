import { useState } from "react";
import { Toggle } from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { useServerEnabled } from "../hooks/useServerEnabled";
import { describeTokenError, formatTokenApprox } from "../utils/tokenHelper";

interface ServerCardProps {
  name: string;
  enabled: boolean;
  transport: string;
  target: string;
  authConfigured: boolean;
  isOAuth: boolean;
  syncedCount: number;
  errorCount: number;
  tokenCount?: {
    tools: number;
    resources: number;
    prompts: number;
    total: number;
    error?: string;
    errorCode?: string;
    runtimeError?: string;
    runtimeErrorCode?: string;
  };
  onRefresh: () => void;
  onClick: () => void;
  onAuthClick?: () => void;
}

export function ServerCard(props: ServerCardProps) {
  const [reauthing, setReauthing] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [confirmingReauth, setConfirmingReauth] = useState(false);
  const isHealthy = props.enabled && props.errorCount === 0 && props.syncedCount > 0;
  const isWarning = props.enabled && props.errorCount > 0;
  const { isToggling, handleEnabledChange } = useServerEnabled(props.name, props.onRefresh);

  async function runReauth() {
    setReauthing(true);
    setReauthError(null);
    try {
      await window.mcpx.startOauth(props.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to re-authenticate";
      // A user-initiated cancel (e.g. from another window) isn't a failure worth showing.
      if (!message.toLowerCase().includes("cancelled")) {
        setReauthError(message);
      }
    } finally {
      setReauthing(false);
      props.onRefresh();
    }
  }

  function handleReauthClick(event: React.MouseEvent) {
    event.stopPropagation();
    if (props.isOAuth) {
      setConfirmingReauth(true);
    } else {
      props.onAuthClick?.();
    }
  }

  const errorEntry = props.tokenCount?.error
    ? { message: props.tokenCount.error, code: props.tokenCount.errorCode }
    : props.tokenCount?.runtimeError
      ? { message: props.tokenCount.runtimeError, code: props.tokenCount.runtimeErrorCode }
      : null;

  return (
    <>
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
              {props.enabled && props.tokenCount && props.tokenCount.total > 0 && (
                <span className="token-badge" title={`${props.tokenCount.tools} tools, ${props.tokenCount.resources} resources, ${props.tokenCount.prompts} prompts`}>
                  {formatTokenApprox(props.tokenCount.total)} tokens
                </span>
              )}
              {props.enabled && errorEntry && (() => {
                // Both the "we couldn't list tools/resources/prompts" error and the
                // call-time runtimeError get the same clickable, re-authenticatable
                // badge -- previously only the former was a real button; a call-time
                // auth failure rendered as an inert <span> with no way to act on it.
                const { label, authLike } = describeTokenError(errorEntry.message, errorEntry.code);
                const buttonLabel = (authLike || props.isOAuth)
                  ? (reauthing ? "Signing in…" : `${label} — re-authenticate`)
                  : label;
                return (
                  <button
                    type="button"
                    className="token-badge token-badge--error token-badge--clickable"
                    title={errorEntry.message}
                    disabled={reauthing}
                    onClick={handleReauthClick}
                  >
                    {buttonLabel}
                  </button>
                );
              })()}
            </div>
            {reauthError && (
              <div className="feedback-message error server-card__reauth-error" onClick={(e) => e.stopPropagation()}>
                {reauthError}
              </div>
            )}
          </div>
        </div>
        <div className="server-card__controls" onClick={(event) => event.stopPropagation()}>
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
          {props.authConfigured ? (
            <div className="server-card__auth" title="Auth configured">
              <span className="material-symbols-outlined">lock</span>
            </div>
          ) : props.transport === "http" ? (
            <button className="btn btn-ghost btn-sm server-card__auth-button" onClick={props.onAuthClick}>
              Configure Auth
            </button>
          ) : null}
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
          <span className="eyebrow">Synced</span>
          <span className="server-card__count" title={`Synced to ${props.syncedCount} client${props.syncedCount === 1 ? "" : "s"}`}>
            {props.enabled ? `${props.syncedCount} clients` : "Off"}
          </span>
        </div>
      </div>
      </div>
      <ConfirmDialog
        open={confirmingReauth}
        title="Re-authenticate?"
        message={`Re-authenticate "${props.name}"? This opens your browser to sign in again.`}
        confirmLabel="Sign in"
        onConfirm={() => {
          setConfirmingReauth(false);
          void runReauth();
        }}
        onCancel={() => setConfirmingReauth(false)}
      />
    </>
  );
}
