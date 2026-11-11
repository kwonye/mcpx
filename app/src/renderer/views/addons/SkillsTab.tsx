import { useEffect, useState } from "react";
import { ArrowUpCircle, Copy, Download, History, NotebookPen, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import type { Skill } from "@mcpx/core";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, InlineAlert, Input, List, ListRow, Menu, SkeletonList, Textarea, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useMutation } from "../../lib/query";
import { refreshAddons, useSkills } from "../../hooks/useAddons";

// Agent Skills naming: lowercase words joined by single hyphens, at most 64 characters.
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function validateSkillName(name: string, existing: string[]): string | null {
  const id = normalizeSkillName(name);
  if (!id) return "Give the skill a name.";
  if (id.length > 64) return "Keep the name to 64 characters or fewer.";
  if (!SKILL_ID.test(id)) return "Use lowercase letters and numbers, with single hyphens between words.";
  if (existing.includes(id)) return `A skill named "${id}" already exists.`;
  return null;
}

function template(id: string): string {
  return `---\nname: ${id}\ndescription: When to use ${id}.\n---\n\nWrite the instructions your AI apps should follow here.\n`;
}

export function SkillsTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const skills = useSkills();
  const toast = useToast();
  const list = skills.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [deleting, setDeleting] = useState<Skill | null>(null);

  const selected = list.find((skill) => skill.id === selectedId) ?? list[0];
  const dirty = Boolean(selected && !selected.readOnly && draft !== selected.content);

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setDraft(selected.content);
    }
  }, [selected?.id, selected?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation(async () => {
    if (!selected) return;
    await api().skills.save(selected.id, draft);
    await refreshAddons();
    toast.success(`Saved ${selected.id}`);
  });

  const action = useMutation(async (kind: "customize" | "update" | "rollback" | "pin" | "unpin") => {
    if (!selected) return;
    if (kind === "customize") {
      const copy = await api().skills.customize(selected.id);
      await refreshAddons();
      setSelectedId(copy.id);
      toast.success(`${copy.id} is now editable`);
      return;
    }
    if (kind === "update") { await api().skills.update(selected.id); toast.success(`Updated ${selected.id}`); }
    if (kind === "rollback") { await api().skills.rollback(selected.id); toast.success(`Rolled back ${selected.id}`); }
    if (kind === "pin") { await api().skills.pin(selected.id); toast.success(`Pinned ${selected.id}`, "It won't update until you unpin it."); }
    if (kind === "unpin") { await api().skills.unpin(selected.id); toast.success(`Unpinned ${selected.id}`); }
    await refreshAddons();
  });

  function select(id: string) {
    if (id === selected?.id) return;
    if (dirty) {
      setPendingSelect(id);
      return;
    }
    setSelectedId(id);
  }

  if (skills.error && !skills.data) return <InlineAlert tone="danger" title="Couldn't load skills">{errorMessage(skills.error)}</InlineAlert>;
  if (skills.loading) return <SkeletonList rows={3} label="Loading skills" />;

  return (
    <div className="view-stack">
      <div className="toolbar toolbar--end">
        <p className="text-muted toolbar__text">Skills are instructions your AI apps load when a task matches. They're shared with every app mcpx manages.</p>
        <Button icon={Download} onClick={() => setInstalling(true)}>Install…</Button>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New skill</Button>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No skills yet" description="Write your own, or install skills from a GitHub repo." actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New skill</Button>} />
      ) : (
        <div className="skills">
          <List label="Skills" className="skills__list">
            {list.map((skill) => (
              <ListRow
                key={skill.id}
                selected={skill.id === selected?.id}
                onOpen={() => select(skill.id)}
                openLabel={skill.id}
                title={<span className="mono">{skill.id}</span>}
                subtitle={skill.readOnly ? "Installed · read-only" : "Yours"}
              />
            ))}
          </List>

          {selected && (
            <section className="skills__editor" aria-label={`Edit ${selected.id}`}>
              <div className="skills__editor-head">
                <h3 className="mono">{selected.id}</h3>
                {selected.readOnly ? <Badge>Read-only</Badge> : dirty ? <Badge tone="accent">Unsaved</Badge> : null}
                <div className="skills__editor-actions">
                  {!selected.readOnly && <Button variant="primary" size="sm" loading={save.pending} disabled={!dirty} onClick={() => void save.run()}>Save</Button>}
                  <Menu
                    label={`More actions for ${selected.id}`}
                    size="sm"
                    items={[
                      selected.readOnly && { label: "Make an editable copy", icon: Copy, onSelect: () => void action.run("customize") },
                      selected.readOnly && { label: "Check for update", icon: ArrowUpCircle, onSelect: () => void action.run("update") },
                      selected.readOnly && { label: "Roll back", icon: History, onSelect: () => void action.run("rollback") },
                      selected.readOnly && { label: "Pin this version", icon: Pin, onSelect: () => void action.run("pin") },
                      selected.readOnly && { label: "Unpin", icon: PinOff, onSelect: () => void action.run("unpin") },
                      !selected.readOnly && dirty && { label: "Discard changes", onSelect: () => setDraft(selected.content) },
                      { label: "Delete", icon: Trash2, danger: true, separated: true, onSelect: () => setDeleting(selected) }
                    ]}
                  />
                </div>
              </div>
              {selected.readOnly && (
                <InlineAlert action={<Button size="sm" icon={Copy} loading={action.pending} onClick={() => void action.run("customize")}>Make editable copy</Button>}>
                  Installed from a source, so it updates with that source and can't be edited here.
                </InlineAlert>
              )}
              {(save.error || action.error) && <InlineAlert tone="danger" onDismiss={() => { save.reset(); action.reset(); }}>{save.error ?? action.error}</InlineAlert>}
              <Textarea
                label={`Contents of ${selected.id}`}
                hideLabel
                className="skills__textarea"
                mono
                value={draft}
                readOnly={selected.readOnly}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                    event.preventDefault();
                    if (dirty) void save.run();
                  }
                }}
              />
              {!selected.readOnly && <p className="text-muted skills__hint">Keep the name and description lines at the top. Press {navigator.platform.includes("Mac") ? "⌘S" : "Ctrl+S"} to save.</p>}
            </section>
          )}
        </div>
      )}

      <NewSkillDialog open={creating} existing={list.map((skill) => skill.id)} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); }} />
      <InstallSkillDialog open={installing} onClose={() => setInstalling(false)} onInstalled={(id) => { setInstalling(false); setSelectedId(id); }} />
      <ConfirmDialog
        open={pendingSelect !== null}
        title="Discard unsaved changes?"
        message="Your edits to this skill haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          if (selected) setDraft(selected.content);
          setSelectedId(pendingSelect);
          setPendingSelect(null);
        }}
        onCancel={() => setPendingSelect(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.id ?? "skill"}?`}
        message="It's removed from every app. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await api().skills.delete(deleting.id);
          toast.success(`Deleted ${deleting.id}`);
          setDeleting(null);
          setSelectedId(null);
          await refreshAddons();
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function NewSkillDialog({ open, existing, onClose, onCreated }: { open: boolean; existing: string[]; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(async (id: string) => {
    await api().skills.save(id, template(id));
    await refreshAddons();
    toast.success(`Created ${id}`);
    onCreated(id);
  });

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      create.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    const problem = validateSkillName(name, existing);
    setError(problem);
    if (!problem) void create.run(normalizeSkillName(name));
  }

  const id = normalizeSkillName(name);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New skill"
      size="sm"
      dismissible={!create.pending}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.pending} onClick={submit}>Create</Button></>}
    >
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Input
          label="Name"
          value={name}
          onChange={(event) => { setName(event.target.value); setError(null); }}
          placeholder="release-notes"
          error={error ?? create.error}
          hint={id && id !== name ? <>Will be saved as <code>{id}</code></> : "Lowercase, no spaces. Apps see this name."}
          mono
        />
      </form>
    </Dialog>
  );
}

function InstallSkillDialog({ open, onClose, onInstalled }: { open: boolean; onClose: () => void; onInstalled: (id: string) => void }) {
  const toast = useToast();
  const [source, setSource] = useState("");
  const [skillName, setSkillName] = useState("");
  const install = useMutation(async () => {
    const skill = await api().skills.install(source.trim(), skillName.trim() || undefined);
    await refreshAddons();
    toast.success(`Installed ${skill.id}`);
    onInstalled(skill.id);
  });

  useEffect(() => {
    if (open) {
      setSource("");
      setSkillName("");
      install.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Install a skill"
      description="From a GitHub repo, git URL or folder that contains a SKILL.md."
      size="sm"
      dismissible={!install.pending}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={install.pending} disabled={!source.trim()} onClick={() => void install.run()}>Install</Button></>}
    >
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (source.trim()) void install.run(); }}>
        <Input label="Source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="owner/repo" mono />
        <Input label="Skill" value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Optional, if the source has several" mono />
        {install.error && <InlineAlert tone="danger" title="Couldn't install">{install.error}</InlineAlert>}
      </form>
    </Dialog>
  );
}
