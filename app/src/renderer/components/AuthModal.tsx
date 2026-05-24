import { useState } from "react";
import { IPC } from "../../shared/ipc-channels";

interface AuthModalProps {
  serverName: string;
  onClose: () => void;
  onConfigured: () => void;
}

export function AuthModal({ serverName, onClose, onConfigured }: AuthModalProps) {
  const [headerName, setHeaderName] = useState("Authorization");
  const [authValue, setAuthValue] = useState("");
  const [secretName, setSecretName] = useState(`auth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_header_authorization`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfigure() {
    if (!authValue.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      await window.mcpx.invoke(IPC.CONFIGURE_AUTH, {
        serverName,
        headerName: headerName.trim(),
        authValue: authValue.trim(),
        secretName: secretName.trim() || undefined
      });
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to configure auth");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-dialog">
        <div className="modal-header">
          <h3 className="modal-title">Auth Required</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-desc">
            Server <strong>"{serverName}"</strong> requires authentication to function.
          </p>

          <div className="modal-form">
            <div className="form-field">
              <label htmlFor="auth-header-name">Header name</label>
              <input
                id="auth-header-name"
                className="glass-input modal-input"
                type="text"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                disabled={submitting}
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
                disabled={submitting}
                autoFocus
              />
            </div>

            <div className="form-field">
              <label htmlFor="auth-secret-name">Secret name (stored in Keychain)</label>
              <input
                id="auth-secret-name"
                className="glass-input modal-input mono-text"
                type="text"
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {error && <div className="feedback-message error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Skip
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfigure}
            disabled={submitting || !authValue.trim()}
          >
            {submitting ? "Configuring..." : "Configure Auth"}
          </button>
        </div>
      </div>
    </div>
  );
}
