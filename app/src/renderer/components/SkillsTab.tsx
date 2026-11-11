import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useSkills } from "../hooks/useSkills";
import { ConfirmDialog } from "./ConfirmDialog";

export interface SkillsTabHandle {
  isDirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

export const SkillsTab = forwardRef<SkillsTabHandle>(function SkillsTab(_props, ref) {
  const { skills, loading, error, refresh, saveSkill, deleteSkill, customizeSkill, updateSkill, rollbackSkill } = useSkills();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const lastSelectedId = useRef<string | null>(null);

  const selectedSkill = skills.find(s => s.id === selectedSkillId);

  useEffect(() => {
    if (!selectedSkill && skills[0]) {
      setSelectedSkillId(skills[0].id);
      return;
    }
    if (selectedSkill && lastSelectedId.current !== selectedSkill.id) {
      setContent(selectedSkill.content);
      setDirty(false);
      lastSelectedId.current = selectedSkill.id;
    }
  }, [selectedSkill, skills]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim()) return;
    
    const id = newSkillName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) return;
    if (skills.some((skill) => skill.id === id)) {
      return;
    }
    const success = await saveSkill(id, `---\nname: ${id}\ndescription: Instructions for using ${id}.\n---\n\nAdd your instructions here.`);
    if (success) {
      setNewSkillName("");
      setIsCreating(false);
      setSelectedSkillId(id);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (!selectedSkill) return false;
    setSaving(true);
    let success = true;
    if (!selectedSkill.readOnly) {
      success = await saveSkill(selectedSkill.id, content);
      if (success) setDirty(false);
    }
    setSaving(false);
    return success;
  };

  const selectSkill = (id: string) => {
    if (id === selectedSkillId) return;
    if (dirty) {
      setPendingSelectionId(id);
      return;
    }
    setSelectedSkillId(id);
  };

  const discardDraftAndSelect = () => {
    if (!pendingSelectionId) return;
    const nextId = pendingSelectionId;
    setPendingSelectionId(null);
    setDirty(false);
    setSelectedSkillId(nextId);
  };

  const saveDraftAndSelect = async () => {
    if (!pendingSelectionId || !selectedSkill || selectedSkill.readOnly) return;
    const nextId = pendingSelectionId;
    const success = await handleSave();
    if (!success) return;
    setDirty(false);
    setPendingSelectionId(null);
    setSelectedSkillId(nextId);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    setDirty(true);
  };

  useImperativeHandle(ref, () => ({
    isDirty: dirty,
    save: async () => {
      const success = await handleSave();
      if (success) setPendingSelectionId(null);
      return success;
    },
    discard: () => {
      if (selectedSkill) setContent(selectedSkill.content);
      setDirty(false);
      setPendingSelectionId(null);
    }
  }), [dirty, selectedSkill, content]);

  const refreshSelectedContent = (result: unknown) => {
    if (result && typeof result === "object" && "content" in result && typeof (result as { content?: unknown }).content === "string") {
      setContent((result as { content: string }).content);
      setDirty(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const success = await deleteSkill(id);
    if (success && selectedSkillId === id) {
      setSelectedSkillId(null);
    }
  };

  const handleExport = async () => {
    const directory = await window.mcpx.selectDirectory();
    if (!directory) return;
    try {
      const result = await window.mcpx.share.export(directory);
      setShareMessage(`Exported ${result.environment.skills.length} skill(s) and ${result.environment.plugins.length} plugin(s).`);
    } catch (e) { setShareMessage(e instanceof Error ? e.message : String(e)); }
  };

  const handleImport = async () => {
    const directory = await window.mcpx.selectDirectory();
    if (!directory) return;
    try {
      const result = await window.mcpx.share.import(directory, { locked: true });
      setShareMessage(`Imported ${result.importedSkills.length} skill(s), ${result.importedServers.length} server(s), and ${result.missingInputs.length} pending input(s).`);
      await refresh();
    } catch (e) { setShareMessage(e instanceof Error ? e.message : String(e)); }
  };

  if (loading) {
    return <div className="loading-state">Loading skills...</div>;
  }

  return (
    <><div className="skills-tab">
      <div className="page-header page-header--split">
        <h1 className="page-title">Shared Skills</h1>
        <div className="skill-editor-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => void handleImport()}>Import</button>
          <button className="btn btn-secondary btn-sm" onClick={() => void handleExport()}>Export</button>
        </div>
        <button
          className="action-button action-button--primary"
          onClick={() => setIsCreating(true)}
        >
          <span className="material-symbols-outlined">add</span>
          <span>New Skill</span>
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="create-skill-form">
          <input
            type="text"
            className="glass-input"
            placeholder="Skill Name"
            value={newSkillName}
            onChange={(e) => setNewSkillName(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsCreating(false)}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm">Create</button>
        </form>
      )}

      {error && <div className="error-panel">{error}</div>}
      {shareMessage && <div className="feedback-message">{shareMessage}</div>}

      <div className="skills-layout">
        <div className="skills-list">
          {skills.map((skill) => (
            <button
              key={skill.id}
              className="skill-list-item"
              data-active={skill.id === selectedSkillId}
              onClick={() => selectSkill(skill.id)}
            >
              <span className="material-symbols-outlined">psychology</span>
              <span>{skill.id}</span>
            </button>
          ))}
          {skills.length === 0 && !isCreating && (
            <div className="empty-state">
              <p>No skills created yet.</p>
            </div>
          )}
        </div>

        <div className="skill-editor">
          {selectedSkill ? (
            <>
              <div className="skill-editor-header">
                <h2>{selectedSkill.id}</h2>
                <div className="skill-editor-actions">
                  {selectedSkill.readOnly && <button className="btn btn-secondary btn-sm" onClick={() => void customizeSkill(selectedSkill.id)}>Customize</button>}
                  {selectedSkill.readOnly && <button className="btn btn-secondary btn-sm" onClick={async () => refreshSelectedContent(await updateSkill(selectedSkill.id))}>Update</button>}
                  {selectedSkill.readOnly && <button className="btn btn-secondary btn-sm" onClick={async () => refreshSelectedContent(await rollbackSkill(selectedSkill.id))}>Rollback</button>}
                  <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(selectedSkill.id)}>
                    <span className="material-symbols-outlined font-icon-sm">delete</span>
                    Delete
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              <textarea
                className="skill-textarea"
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                readOnly={selectedSkill.readOnly}
                placeholder="Enter skill instructions..."
              />
            </>
          ) : (
            <div className="empty-state">
              <p>Select or create a skill.</p>
            </div>
          )}
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={pendingSelectionId !== null}
      title="Unsaved changes"
      message="Save your changes before switching skills?"
      initialFocus="cancel"
      confirmLabel="Save"
      secondaryLabel="Discard"
      onConfirm={() => void saveDraftAndSelect()}
      onSecondary={discardDraftAndSelect}
      onCancel={() => setPendingSelectionId(null)}
    />
    <ConfirmDialog
      open={confirmDeleteId !== null}
      title="Delete skill?"
      message={confirmDeleteId ? `Delete skill "${confirmDeleteId}"?` : ""}
      confirmLabel="Delete"
      destructive
      onConfirm={handleConfirmDelete}
      onCancel={() => setConfirmDeleteId(null)}
    /></>
  );
});
