import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button, Dialog, InlineAlert, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { baseName } from "../../lib/format";

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
  existingPaths: string[];
  onAdded: (path: string, name: string) => void;
}

export function AddProjectDialog({ open, onClose, existingPaths, onAdded }: AddProjectDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ path?: string; name?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPath("");
    setName("");
    setErrors({});
    setSubmitError(null);
  }, [open]);

  async function choose() {
    try {
      const selected = await api().app.selectDirectory();
      if (!selected) return;
      setPath(selected);
      setErrors({});
      if (!name.trim()) setName(baseName(selected));
    } catch (error) {
      setSubmitError(errorMessage(error, "Couldn't open the folder picker."));
    }
  }

  async function add() {
    const nextErrors: { path?: string; name?: string } = {};
    if (!path.trim()) nextErrors.path = "Choose the project's folder.";
    else if (existingPaths.includes(path.trim())) nextErrors.path = "This folder is already a project.";
    if (!name.trim()) nextErrors.name = "Give the project a name.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await api().projects.add(path.trim(), name.trim());
      onAdded(path.trim(), name.trim());
    } catch (error) {
      setSubmitError(errorMessage(error, "Couldn't add the project."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a project"
      description="Pick a code folder. Inside it, your AI apps can use a different set of servers and add-ons."
      size="sm"
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void add()}>Add project</Button>
        </>
      }
    >
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <div className="toolbar">
          <Input label="Folder" value={path} readOnly placeholder="No folder chosen" mono error={errors.path} />
          <Button icon={FolderOpen} onClick={() => void choose()} data-autofocus>Choose…</Button>
        </div>
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} />
        {submitError && <InlineAlert tone="danger">{submitError}</InlineAlert>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
