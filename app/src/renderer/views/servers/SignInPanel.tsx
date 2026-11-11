import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, KeyRound, LogIn } from "lucide-react";
import type { OAuthSupport } from "@mcpx/core";
import { Button, InlineAlert, Input, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage, isCancellation } from "../../lib/errors";
import "./SignInPanel.css";

type Phase = "idle" | "discovering" | "awaiting-browser" | "exchanging" | "syncing";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  discovering: "Connecting to the server…",
  "awaiting-browser": "Waiting for you to finish in your browser…",
  exchanging: "Finishing sign-in…",
  syncing: "Updating your apps…"
};

export interface SignInPanelProps {
  serverName: string;
  transport: "http" | "stdio";
  /** Discovery verdict if already known (e.g. from the add-server probe). */
  oauthSupport?: OAuthSupport;
  onSignedIn: () => void;
  /** Called with a cancel function while browser sign-in is running, null otherwise. */
  onRunningChange?: (cancel: (() => void) | null) => void;
  secondaryAction?: { label: string; onClick: () => void };
}

/**
 * Sign-in for one server. Browser sign-in (OAuth) is always offered first
 * for URL servers; discovery only refines the hint and never gates the
 * button. A pasted token is the fallback.
 */
export function SignInPanel({ serverName, transport, oauthSupport: initialSupport, onSignedIn, onRunningChange, secondaryAction }: SignInPanelProps) {
  const [support, setSupport] = useState<OAuthSupport | undefined>(initialSupport);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showToken, setShowToken] = useState(transport !== "http");
  const [headerName, setHeaderName] = useState(transport === "http" ? "Authorization" : "");
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const runningChange = useRef(onRunningChange);
  runningChange.current = onRunningChange;

  const running = phase !== "idle";

  useEffect(() => {
    if (transport !== "http" || support !== undefined) return;
    let cancelled = false;
    setChecking(true);
    api().auth.checkOAuthSupport(serverName)
      .then((result) => !cancelled && setSupport(result.support))
      .catch(() => !cancelled && setSupport("unknown"))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [serverName, transport, support]);

  useEffect(() => {
    if (support === "unsupported") setShowToken(true);
  }, [support]);

  useEffect(() => api().auth.onOAuthProgress((event) => {
    if (event.serverName !== serverName) return;
    if (event.phase === "done" || event.phase === "cancelled" || event.phase === "error") {
      setPhase("idle");
      setExpiresAt(null);
      return;
    }
    if (event.phase in PHASE_LABEL) setPhase(event.phase as Phase);
    if (event.phase === "awaiting-browser") setExpiresAt(event.expiresAt ?? null);
  }), [serverName]);

  useEffect(() => {
    runningChange.current?.(running ? () => void api().auth.cancelOAuth(serverName).catch(() => {}) : null);
  }, [running, serverName]);

  useEffect(() => {
    if (phase !== "awaiting-browser" || !expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase, expiresAt]);

  async function signInWithBrowser() {
    setOauthError(null);
    setPhase("discovering");
    try {
      await api().auth.startOAuth(serverName);
      setPhase("idle");
      onSignedIn();
    } catch (error) {
      setPhase("idle");
      if (!isCancellation(error)) setOauthError(errorMessage(error, "Sign-in didn't finish."));
    }
  }

  async function saveToken() {
    if (!token.trim()) {
      setTokenError("Paste a token or API key.");
      return;
    }
    if (!headerName.trim()) {
      setTokenError(transport === "http" ? "Enter the header the server expects." : "Enter the environment variable the server reads, like GITHUB_TOKEN.");
      return;
    }
    setSavingToken(true);
    setTokenError(null);
    try {
      await api().auth.configure({
        serverName,
        ...(transport === "http" ? { headerName: headerName.trim() } : { envName: headerName.trim() }),
        authValue: token.trim()
      });
      onSignedIn();
    } catch (error) {
      setTokenError(errorMessage(error, "Couldn't save the token."));
    } finally {
      setSavingToken(false);
    }
  }

  if (running) {
    const seconds = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : null;
    return (
      <div className="sign-in sign-in--waiting" aria-live="polite">
        <Spinner size={18} />
        <p className="sign-in__phase">{PHASE_LABEL[phase as Exclude<Phase, "idle">]}</p>
        {phase === "awaiting-browser" && (
          <>
            <p className="sign-in__muted">Approve access for <strong>{serverName}</strong> in the browser window that just opened, then come back here.</p>
            <div className="sign-in__row">
              <Button size="sm" icon={ExternalLink} onClick={() => void api().auth.reopenOAuth(serverName).catch(() => {})}>Open the page again</Button>
              <Button size="sm" variant="ghost" onClick={() => void api().auth.cancelOAuth(serverName).catch(() => {})}>Cancel</Button>
            </div>
            {seconds !== null && <p className="sign-in__muted sign-in__countdown">Link expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>}
          </>
        )}
      </div>
    );
  }

  const hint = checking
    ? "Checking how this server signs in…"
    : support === "supported"
      ? "Recommended. Opens your browser to approve access."
      : support === "unsupported"
        ? "This server doesn't advertise browser sign-in. You can still try it, or use a token."
        : support === "unknown"
          ? "Couldn't check whether this server supports browser sign-in."
          : null;

  return (
    <div className="sign-in">
      {transport === "http" && (
        <div className="sign-in__primary">
          <Button variant={support === "unsupported" ? "secondary" : "primary"} icon={LogIn} onClick={() => void signInWithBrowser()}>
            Sign in with browser
          </Button>
          {hint && <p className="sign-in__muted">{hint}</p>}
          {oauthError && <InlineAlert tone="danger">{oauthError}</InlineAlert>}
        </div>
      )}

      {transport === "http" && (
        <button type="button" className="sign-in__disclosure" aria-expanded={showToken} onClick={() => setShowToken((value) => !value)}>
          {showToken ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          Use a token or API key instead
        </button>
      )}

      {showToken && (
        <form
          className="sign-in__token"
          onSubmit={(event) => {
            event.preventDefault();
            void saveToken();
          }}
        >
          <Input
            label="Token or API key"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste it here"
            hint={transport === "http" ? "Stored as a secret. A bare token is sent as “Bearer …”." : "Stored as a secret and passed to the server when it starts."}
            error={tokenError}
            leading={<KeyRound size={14} />}
            autoFocus={transport !== "http"}
          />
          <Input
            label={transport === "http" ? "Header" : "Environment variable"}
            value={headerName}
            onChange={(event) => setHeaderName(event.target.value)}
            placeholder={transport === "http" ? undefined : "GITHUB_TOKEN"}
            mono
            hint={transport === "http" ? "Most servers use Authorization." : "The variable the server reads its token from."}
          />
          <div className="sign-in__row sign-in__row--end">
            {secondaryAction && <Button variant="ghost" onClick={secondaryAction.onClick} disabled={savingToken}>{secondaryAction.label}</Button>}
            <Button type="submit" variant="primary" loading={savingToken}>Save token</Button>
          </div>
        </form>
      )}

      {!showToken && secondaryAction && (
        <div className="sign-in__row sign-in__row--end">
          <Button variant="ghost" onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
        </div>
      )}
    </div>
  );
}
