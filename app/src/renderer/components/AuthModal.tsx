import { useEffect, useState } from "react";
import { IPC } from "../../shared/ipc-channels";

type OAuthSupport = "supported" | "unsupported" | "unknown";
type OAuthPhase = "idle" | "discovering" | "awaiting-browser" | "exchanging" | "syncing";

interface AuthModalProps {
  serverName: string;
  transport: "http" | "stdio";
  /** RFC 9728/8414 discovery verdict, if already known (e.g. from an add-server probe). */
  oauthSupport?: OAuthSupport;
  onClose: () => void;
  onConfigured: () => void;
}

const PHASE_LABEL: Record<Exclude<OAuthPhase, "idle">, string> = {
  discovering: "Connecting…",
  "awaiting-browser": "Waiting for your browser…",
  exchanging: "Finishing sign-in…",
  syncing: "Updating your clients…"
};

export function AuthModal({ serverName, transport, oauthSupport: initialOauthSupport, onClose, onConfigured }: AuthModalProps) {
  const [oauthSupport, setOauthSupport] = useState<OAuthSupport | undefined>(initialOauthSupport);
  const [checkingSupport, setCheckingSupport] = useState(false);
  const [oauthPhase, setOauthPhase] = useState<OAuthPhase>("idle");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showManualForm, setShowManualForm] = useState(transport !== "http");
  const [headerName, setHeaderName] = useState("Authorization");
  const [authValue, setAuthValue] = useState("");
  const [secretName, setSecretName] = useState(`auth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_header_authorization`);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const oauthRunning = oauthPhase !== "idle";

  // Discovery is a network round trip, so it must never gate whether the
  // "Sign in with browser" button is shown -- only its copy. The button is
  // always offered for HTTP servers; this effect just refines the hint text.
  useEffect(() => {
    if (transport !== "http" || oauthSupport !== undefined || !window.mcpx.checkOauthSupport) {
      return;
    }
    let cancelled = false;
    setCheckingSupport(true);
    window.mcpx
      .checkOauthSupport(serverName)
      .then((result: { support: OAuthSupport }) => {
        if (!cancelled) setOauthSupport(result.support);
      })
      .catch(() => {
        if (!cancelled) setOauthSupport("unknown");
      })
      .finally(() => {
        if (!cancelled) setCheckingSupport(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverName, transport, oauthSupport]);

  // Auto-expand the manual token form once we know OAuth isn't an option --
  // regardless of whether that verdict arrived via a prop (e.g. from an
  // add-server probe) or from the checkOauthSupport call above.
  useEffect(() => {
    if (oauthSupport === "unsupported") {
      setShowManualForm(true);
    }
  }, [oauthSupport]);

  // Live progress for this server's OAuth login, driving the waiting panel.
  useEffect(() => {
    return window.mcpx.onOauthProgress?.((event) => {
      if (event.serverName !== serverName) return;
      if (event.phase === "done" || event.phase === "cancelled" || event.phase === "error") {
        setOauthPhase("idle");
        setAuthorizationUrl(null);
        setExpiresAt(null);
        return;
      }
      setOauthPhase(event.phase as OAuthPhase);
      if (event.phase === "awaiting-browser") {
        setAuthorizationUrl(event.authorizationUrl ?? null);
        setExpiresAt(event.expiresAt ?? null);
      }
    });
  }, [serverName]);

  // Countdown while waiting on the browser.
  useEffect(() => {
    if (oauthPhase !== "awaiting-browser" || !expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [oauthPhase, expiresAt]);

  async function handleOauthLogin() {
    setOauthError(null);
    try {
      await window.mcpx.startOauth(serverName);
      onConfigured();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start OAuth login";
      setOauthPhase("idle");
      // A user-initiated cancel isn't an error -- just return to idle quietly.
      if (!message.toLowerCase().includes("cancelled")) {
        setOauthError(message);
      }
    }
  }

  function handleCancelOauth() {
    void window.mcpx.cancelOauth(serverName).catch(() => {});
  }

  function handleReopenLink() {
    void window.mcpx.reopenOauthUrl(serverName).catch(() => {});
  }

  async function handleConfigure() {
    if (!authValue.trim()) return;
    setManualSubmitting(true);
    setManualError(null);

    try {
      await window.mcpx.invoke(IPC.CONFIGURE_AUTH, {
        serverName,
        headerName: headerName.trim(),
        authValue: authValue.trim(),
        secretName: secretName.trim() || undefined
      });
      onConfigured();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to configure auth");
    } finally {
      setManualSubmitting(false);
    }
  }

  function handleClose() {
    if (oauthRunning) {
      // Never leave an OAuth flow orphaned (loopback server still listening,
      // browser tab still open) just because the modal was dismissed.
      handleCancelOauth();
    }
    onClose();
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthRunning]);

  const secondsLeft = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : null;
  const countdown = secondsLeft !== null ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : null;

  const hint = checkingSupport
    ? "Checking sign-in options…"
    : oauthSupport === "supported"
      ? "Recommended — this server supports single sign-on."
      : oauthSupport === "unsupported"
        ? "This server didn't advertise OAuth. You can still try it, or use a token below."
        : oauthSupport === "unknown"
          ? "Couldn't check whether this server supports OAuth."
          : null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={`Sign in to ${serverName}`}>
        <div className="modal-header">
          <h3 className="modal-title">Auth Required</h3>
          <button type="button" className="modal-close-btn" onClick={handleClose}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
          </button>
        </div>

        <div className="modal-body">
          {oauthRunning ? (
            <div className="auth-modal-waiting">
              <span className="auth-modal-spinner material-symbols-outlined">progress_activity</span>
              <p className="auth-modal-waiting__title">{PHASE_LABEL[oauthPhase]}</p>
              {oauthPhase === "awaiting-browser" && (
                <>
                  <p className="modal-desc">
                    Finish signing in to <strong>"{serverName}"</strong> in your browser, then come back here.
                  </p>
                  <div className="auth-modal-waiting__actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleReopenLink}>
                      Reopen link
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancelOauth}>
                      Cancel
                    </button>
                  </div>
                  {countdown && <p className="auth-modal-waiting__countdown">Expires in {countdown}</p>}
                </>
              )}
            </div>
          ) : (
            <>
              <p className="modal-desc">
                Server <strong>"{serverName}"</strong> requires authentication to function.
              </p>

              {transport === "http" && (
                <div className="auth-modal-oauth">
                  <button type="button" className="btn btn-primary" onClick={handleOauthLogin}>
                    Sign in with browser
                  </button>
                  {hint && <p className="auth-modal-hint">{hint}</p>}
                </div>
              )}

              {oauthError && <div className="feedback-message error">{oauthError}</div>}

              {transport === "http" && (
                <button
                  type="button"
                  className="auth-modal-disclosure"
                  aria-expanded={showManualForm}
                  onClick={() => setShowManualForm((value) => !value)}
                >
                  <span className="material-symbols-outlined">{showManualForm ? "expand_less" : "expand_more"}</span>
                  Use an API key or token instead
                </button>
              )}

              {showManualForm && (
                <div className="modal-form">
                  <div className="form-field">
                    <label htmlFor="auth-header-name">Header name</label>
                    <input
                      id="auth-header-name"
                      className="glass-input modal-input"
                      type="text"
                      value={headerName}
                      onChange={(e) => setHeaderName(e.target.value)}
                      disabled={manualSubmitting}
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="auth-value">Auth value</label>
                    <input
                      id="auth-value"
                      className="glass-input modal-input"
                      type="password"
                      value={authValue}
                      onChange={(e) => setAuthValue(e.target.value)}
                      placeholder="Paste your API key or token..."
                      disabled={manualSubmitting}
                      autoFocus={transport !== "http"}
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor="auth-secret-name">Secret name (stored encrypted)</label>
                    <input
                      id="auth-secret-name"
                      className="glass-input modal-input mono-text"
                      type="text"
                      value={secretName}
                      onChange={(e) => setSecretName(e.target.value)}
                      disabled={manualSubmitting}
                    />
                  </div>
                </div>
              )}

              {manualError && <div className="feedback-message error">{manualError}</div>}
            </>
          )}
        </div>

        {!oauthRunning && (
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={manualSubmitting}>
              Skip
            </button>
            {showManualForm && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfigure}
                disabled={manualSubmitting || !authValue.trim()}
              >
                {manualSubmitting ? "Configuring..." : "Save token"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
