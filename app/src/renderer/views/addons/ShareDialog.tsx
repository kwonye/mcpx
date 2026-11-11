import { useEffect, useState } from "react";
import { FolderDown, FolderUp } from "lucide-react";
import { Button, Dialog, InlineAlert, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { plural } from "../../lib/format";
import { useMutation } from "../../lib/query";
import { refreshAddons } from "../../hooks/useAddons";
import { refreshStatus } from "../../hooks/useServers";
import type { ShareImportResult } from "../../../shared/ipc-contract";

type Mode = "choose" | "review" | "done";

function describe(result: { importedSkills: string[]; importedPlugins: string[]; importedServers: string[] }): string {
  const parts = [
    result.importedServers.length > 0 && plural(result.importedServers.length, "server"),
    result.importedPlugins.length > 0 && plural(result.importedPlugins.length, "plugin"),
    result.importedSkills.length > 0 && plural(result.importedSkills.length, "skill")
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

/**
 * Export writes your servers, plugins and skills to a folder you can commit
 * or send; import reads one back (verified against its lockfile), asking for
 * any values the environment needs, such as API keys.
 */
export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [directory, setDirectory] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShareImportResult | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setMode("choose");
    setDirectory(null);
    setPreview(null);
    setInputs({});
    setSummary(null);
    setInputErrors({});
  }, [open]);

  const exportEnv = useMutation(async () => {
    const target = await api().app.selectDirectory();
    if (!target) return;
    const result = await api().share.export(target);
    const env = result.environment;
    setSummary(`Exported ${describe({
      importedServers: Object.keys(env.servers ?? {}),
      importedPlugins: env.plugins.map((entry) => entry.id),
      importedSkills: env.skills.map((entry) => entry.id)
    })} to ${target}.`);
    setMode("done");
  });

  const chooseImport = useMutation(async () => {
    const source = await api().app.selectDirectory();
    if (!source) return;
    const result = await api().share.import(source, { locked: true, dryRun: true });
    setDirectory(source);
    setPreview(result);
    setMode("review");
  });

  const runImport = useMutation(async () => {
    if (!directory || !preview) return;
    const missing = Object.fromEntries(preview.missingInputs.filter((name) => !inputs[name]?.trim()).map((name) => [name, "Required"]));
    setInputErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const result = await api().share.import(directory, { locked: true, inputs });
    await Promise.all([refreshAddons(), refreshStatus()]);
    setSummary(`Imported ${describe(result)}.`);
    setMode("done");
  });

  const busy = exportEnv.pending || chooseImport.pending || runImport.pending;
  const error = exportEnv.error ?? chooseImport.error ?? runImport.error;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "review" ? "Review import" : mode === "done" ? "Done" : "Import or export your environment"}
      description={mode === "choose" ? "Move your servers, plugins and skills between computers, or share them with your team. Secret values are never exported." : undefined}
      size="md"
      dismissible={!busy}
      footer={
        mode === "review" ? (
          <>
            <Button variant="ghost" onClick={() => setMode("choose")} disabled={busy}>Back</Button>
            <Button variant="primary" loading={runImport.pending} onClick={() => void runImport.run()}>Import</Button>
          </>
        ) : mode === "done" ? (
          <Button variant="primary" onClick={onClose} data-autofocus>Done</Button>
        ) : undefined
      }
    >
      {mode === "choose" && (
        <div className="share-choices">
          <button type="button" className="share-choice" onClick={() => void exportEnv.run()} disabled={busy}>
            <FolderUp size={18} strokeWidth={1.75} aria-hidden />
            <span className="share-choice__title">{exportEnv.pending ? "Exporting…" : "Export to a folder"}</span>
            <span className="share-choice__copy">Writes an environment file and a lockfile.</span>
          </button>
          <button type="button" className="share-choice" onClick={() => void chooseImport.run()} disabled={busy}>
            <FolderDown size={18} strokeWidth={1.75} aria-hidden />
            <span className="share-choice__title">{chooseImport.pending ? "Reading…" : "Import from a folder"}</span>
            <span className="share-choice__copy">Shows what will be added before anything changes.</span>
          </button>
        </div>
      )}

      {mode === "review" && preview && (
        <div className="form-stack">
          <p>This will add {describe(preview)} from <span className="mono">{directory}</span>.</p>
          {preview.missingInputs.length > 0 && (
            <>
              <p className="text-muted">The environment needs these values. They're stored as secrets on this computer.</p>
              {preview.missingInputs.map((name) => (
                <Input
                  key={name}
                  label={name}
                  type="password"
                  mono
                  value={inputs[name] ?? ""}
                  error={inputErrors[name]}
                  onChange={(event) => setInputs((current) => ({ ...current, [name]: event.target.value }))}
                />
              ))}
            </>
          )}
        </div>
      )}

      {mode === "done" && summary && <InlineAlert tone="success">{summary}</InlineAlert>}
      {error && <InlineAlert tone="danger" className="share-error">{errorMessage(error)}</InlineAlert>}
    </Dialog>
  );
}
