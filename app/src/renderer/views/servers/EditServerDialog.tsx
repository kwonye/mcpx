import { useEffect, useState } from "react";
import { Button, Dialog, InlineAlert, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { buildSpec, draftFromSpec, rowsFromBindings, type ServerDraft } from "../../lib/serverSpec";
import { refreshStatus, type ServerView } from "../../hooks/useServers";
import { ConnectionFields } from "./ConnectionFields";

interface EditServerDialogProps {
  server: ServerView | null;
  onClose: () => void;
}

function initialDraft(server: ServerView): ServerDraft {
  const kind = server.transport === "http" ? "header" : "env";
  const spec = server.spec ?? (server.transport === "http"
    ? { transport: "http" as const, url: server.target }
    : { transport: "stdio" as const, command: server.target });
  return draftFromSpec(spec, rowsFromBindings(server.authBindings, kind));
}

export function EditServerDialog({ server, onClose }: EditServerDialogProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(server ? initialDraft(server) : null);
    setErrors({});
    setSaveError(null);
  }, [server?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!server || !draft) return;
    const built = buildSpec(server.name, draft);
    setErrors(built.errors);
    if (Object.keys(built.errors).length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api().servers.update(server.name, built.spec, built.secrets);
      await refreshStatus();
      toast.success(`Saved ${server.name}`);
      onClose();
    } catch (error) {
      setSaveError(errorMessage(error, "Couldn't save changes."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={server !== null && draft !== null}
      onClose={onClose}
      title={server ? `Edit ${server.name}` : "Edit server"}
      description={server?.transport === "http" ? "Changes apply to every app that uses this server." : "mcpx restarts the command with these settings for every app."}
      size="lg"
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save changes</Button>
        </>
      }
    >
      {draft && (
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <ConnectionFields draft={draft} onChange={setDraft} errors={errors} />
          {saveError && <InlineAlert tone="danger" title="Couldn't save">{saveError}</InlineAlert>}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
