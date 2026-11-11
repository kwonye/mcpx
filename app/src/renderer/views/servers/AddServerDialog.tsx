import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Globe, TerminalSquare, Wand2 } from "lucide-react";
import type { OAuthSupport, SyncSummary } from "@mcpx/core";
import { Button, Dialog, InlineAlert, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { clientName } from "../../lib/domain";
import { errorMessage } from "../../lib/errors";
import { buildSpec, draftFromSpec, rowsFromRecord, validateServerName, type ServerDraft } from "../../lib/serverSpec";
import { refreshStatus } from "../../hooks/useServers";
import type { ParsedServerInput } from "../../../shared/ipc-contract";
import { ConnectionFields } from "./ConnectionFields";
import { SignInPanel } from "./SignInPanel";
import "./AddServerDialog.css";

type Step = "source" | "details" | "sign-in" | "done";

interface AddServerDialogProps {
  open: boolean;
  onClose: () => void;
  existingNames: string[];
  onAdded?: (name: string) => void;
}

const EXAMPLES = [
  "https://mcp.linear.app/mcp",
  "npx -y @modelcontextprotocol/server-filesystem ~/Documents",
  "claude mcp add --transport http github https://api.githubcopilot.com/mcp/"
];

const KIND_COPY: Record<ParsedServerInput["kind"], string> = {
  url: "Remote server URL",
  command: "Local command",
  "client-command": "Imported from a pasted add command"
};

function blankDraft(transport: "http" | "stdio"): ServerDraft {
  return { transport, url: "", command: "", args: [], cwd: "", rows: [] };
}

/**
 * The one guided add flow: paste anything -> confirm name and details ->
 * sign in if the server asks -> done.
 */
export function AddServerDialog({ open, onClose, existingNames, onAdded }: AddServerDialogProps) {
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [detected, setDetected] = useState<ParsedServerInput["kind"] | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerDraft>(blankDraft("http"));
  const [force, setForce] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [oauthSupport, setOauthSupport] = useState<OAuthSupport | undefined>();
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const cancelOAuth = useRef<(() => void) | null>(null);
  const sourceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("source");
    setSource("");
    setSourceError(null);
    setDetected(null);
    setName("");
    setNameError(null);
    setDraft(blankDraft("http"));
    setForce(false);
    setFieldErrors({});
    setSubmitError(null);
    setSync(null);
    setSignedIn(false);
    setOauthSupport(undefined);
  }, [open]);

  function close() {
    cancelOAuth.current?.();
    cancelOAuth.current = null;
    onClose();
  }

  async function parseSource() {
    if (!source.trim()) {
      setSourceError("Paste a URL or a command first.");
      return;
    }
    setParsing(true);
    setSourceError(null);
    try {
      const parsed = await api().servers.parseInput(source);
      const rows = rowsFromRecord(parsed.spec.transport === "http" ? parsed.spec.headers : parsed.spec.env);
      setDetected(parsed.kind);
      setName(uniqueName(parsed.name, existingNames));
      setForce(Boolean(parsed.force));
      setDraft(draftFromSpec(parsed.spec, rows));
      setFieldErrors({});
      setStep("details");
    } catch (error) {
      setSourceError(errorMessage(error, "That doesn't look like a server URL or command."));
    } finally {
      setParsing(false);
    }
  }

  function startManual(transport: "http" | "stdio") {
    setDetected(null);
    setDraft(blankDraft(transport));
    setName("");
    setFieldErrors({});
    setStep("details");
  }

  async function add() {
    const trimmed = name.trim();
    const nameProblem = validateServerName(trimmed, force ? [] : existingNames);
    setNameError(nameProblem);
    const built = buildSpec(trimmed || "server", draft);
    setFieldErrors(built.errors);
    if (nameProblem || Object.keys(built.errors).length > 0) return;

    setAdding(true);
    setSubmitError(null);
    try {
      const result = await api().servers.add({ name: trimmed, spec: built.spec, secrets: built.secrets, force });
      setSync(result.sync);
      onAdded?.(trimmed);
      void refreshStatus();
      if (result.authRequired) {
        setOauthSupport(result.oauthSupport);
        setStep("sign-in");
      } else {
        setStep("done");
      }
    } catch (error) {
      setSubmitError(errorMessage(error, "Couldn't add the server."));
    } finally {
      setAdding(false);
    }
  }

  const title = step === "source" ? "Add a server"
    : step === "details" ? "Check the details"
      : step === "sign-in" ? `Sign in to ${name}`
        : `${name} is ready`;
  const description = step === "source"
    ? "Paste a server URL, a launch command, or an add command from another app's docs."
    : step === "details"
      ? "mcpx will make this server available to all your AI apps."
      : step === "sign-in"
        ? "This server asked for sign-in before your apps can use it."
        : undefined;

  const footer = step === "source" ? (
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button variant="primary" loading={parsing} onClick={() => void parseSource()}>Continue</Button>
    </>
  ) : step === "details" ? (
    <>
      <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep("source")} disabled={adding} className="add-server__back">Back</Button>
      <Button variant="primary" loading={adding} onClick={() => void add()}>Add server</Button>
    </>
  ) : step === "done" ? (
    <>
      <Button variant="ghost" onClick={() => { setStep("source"); setSource(""); setSync(null); setSignedIn(false); }}>Add another</Button>
      <Button variant="primary" onClick={close} data-autofocus>Done</Button>
    </>
  ) : undefined;

  return (
    <Dialog open={open} onClose={close} title={title} description={description} size="md" dismissible={!adding} footer={footer} initialFocusRef={step === "source" ? sourceRef : undefined}>
      {step === "source" && (
        <form className="add-server" onSubmit={(event) => { event.preventDefault(); void parseSource(); }}>
          <Input
            ref={sourceRef}
            label="URL or command"
            hideLabel
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="https://… or npx … or claude mcp add …"
            error={sourceError}
            mono
            leading={<Wand2 size={14} />}
            inputClassName="add-server__source"
          />
          <div className="add-server__examples">
            <p className="add-server__eyebrow">Examples</p>
            <ul>
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" className="add-server__example mono" onClick={() => { setSource(example); setSourceError(null); sourceRef.current?.focus(); }}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
            <p className="add-server__formats">Also understands <code>codex mcp add</code>, <code>code --add-mcp</code> and <code>mcpx add</code>.</p>
          </div>
          <div className="add-server__manual">
            <span>Or set it up by hand:</span>
            <Button size="sm" variant="ghost" icon={Globe} onClick={() => startManual("http")}>Remote URL</Button>
            <Button size="sm" variant="ghost" icon={TerminalSquare} onClick={() => startManual("stdio")}>Local command</Button>
          </div>
        </form>
      )}

      {step === "details" && (
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          {detected && <p className="add-server__detected"><CheckCircle2 size={14} aria-hidden /> {KIND_COPY[detected]}</p>}
          <Input
            label="Name"
            value={name}
            onChange={(event) => { setName(event.target.value); setNameError(null); }}
            error={nameError}
            hint="How this server appears in your apps."
            mono
            data-autofocus
          />
          <ConnectionFields draft={draft} onChange={setDraft} errors={fieldErrors} />
          {submitError && <InlineAlert tone="danger" title="Couldn't add the server">{submitError}</InlineAlert>}
          <button type="submit" hidden />
        </form>
      )}

      {step === "sign-in" && (
        <SignInPanel
          serverName={name}
          transport={draft.transport}
          oauthSupport={oauthSupport}
          onRunningChange={(cancel) => { cancelOAuth.current = cancel; }}
          onSignedIn={() => {
            cancelOAuth.current = null;
            setSignedIn(true);
            void refreshStatus();
            setStep("done");
          }}
          secondaryAction={{ label: "Skip for now", onClick: () => setStep("done") }}
        />
      )}

      {step === "done" && <DoneSummary name={name} sync={sync} signedIn={signedIn} />}
    </Dialog>
  );
}

function DoneSummary({ name, sync, signedIn }: { name: string; sync: SyncSummary | null; signedIn: boolean }) {
  const synced = (sync?.results ?? []).filter((result) => result.status === "SYNCED").map((result) => clientName(result.clientId));
  const failed = (sync?.results ?? []).filter((result) => result.status === "ERROR");
  return (
    <div className="add-server__done">
      <span className="add-server__done-icon" aria-hidden><CheckCircle2 size={22} strokeWidth={1.75} /></span>
      <p>
        {synced.length > 0
          ? <>Available in {formatList(synced)}.</>
          : <>Added. It will appear in your apps after their next sync.</>}
        {signedIn && " You're signed in."}
      </p>
      {failed.length > 0 && (
        <InlineAlert tone="warning" title={`Couldn't update ${formatList(failed.map((result) => clientName(result.clientId)))}`}>
          {failed[0].message ?? "Open Clients to see what went wrong."}
        </InlineAlert>
      )}
      <p className="add-server__muted">Restart an app if it was already open so it picks up <strong>{name}</strong>.</p>
    </div>
  );
}

function formatList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
