import { useEffect, useState } from "react";
import { useSkills } from "../hooks/useSkills";
import { ConfirmDialog } from "./ConfirmDialog";

export function SkillsTab() {
  const { skills, loading, saveSkill, deleteSkill } = useSkills();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedSkill = skills.find(s => s.id === selectedSkillId);

  useEffect(() => {
    if (!selectedSkill && skills[0]) {
      setSelectedSkillId(skills[0].id);
      return;
    }
    if (selectedSkill) {
      setContent(selectedSkill.content);
    }
  }, [selectedSkill, skills]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkillName.trim()) return;
    
    const id = newSkillName.trim().toLowerCase().replace(/\s+/g, "-");
    const success = await saveSkill(id, `# ${newSkillName}\n\nAdd your instructions here.`);
    if (success) {
      setNewSkillName("");
      setIsCreating(false);
      setSelectedSkillId(id);
    }
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    await saveSkill(selectedSkill.id, content);
    setSaving(false);
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

  if (loading) {
    return <div className="loading-state">Loading skills...</div>;
  }

  return (
    <div className="skills-tab">
      <div className="page-header page-header--split">
        <h1 className="page-title">Shared Skills</h1>
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

      <div className="skills-layout">
        <div className="skills-list">
          {skills.map((skill) => (
            <button
              key={skill.id}
              className="skill-list-item"
              data-active={skill.id === selectedSkillId}
              onClick={() => setSelectedSkillId(skill.id)}
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
                  <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(selectedSkill.id)}>
                    <span className="material-symbols-outlined font-icon-sm">delete</span>
                    Delete
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              <textarea
                className="skill-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
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
      open={confirmDeleteId !== null}
      title="Delete skill?"
      message={confirmDeleteId ? `Delete skill "${confirmDeleteId}"?` : ""}
      confirmLabel="Delete"
      destructive
      onConfirm={handleConfirmDelete}
      onCancel={() => setConfirmDeleteId(null)}
    />
  );
}
