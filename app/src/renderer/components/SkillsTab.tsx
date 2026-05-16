import { useState } from "react";
import { useSkills } from "../hooks/useSkills";
import { SkillEditor } from "./SkillEditor";

export function SkillsTab() {
  const { skills, loading, saveSkill, deleteSkill, refresh } = useSkills();
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");

  const selectedSkill = skills.find(s => s.id === selectedSkillId);

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

  if (loading) {
    return <div className="loading-state">Loading skills...</div>;
  }

  if (selectedSkill) {
    return (
      <SkillEditor 
        skill={selectedSkill} 
        onSave={saveSkill} 
        onBack={() => setSelectedSkillId(null)} 
      />
    );
  }

  return (
    <div className="skills-tab">
      <div className="page-header">
        <h1 className="page-title">Shared Skills</h1>
        <div className="page-header-actions">
          <button 
            className="action-button action-button--primary"
            onClick={() => setIsCreating(true)}
          >
            <span className="material-symbols-outlined">add</span>
            <span>New Skill</span>
          </button>
        </div>
      </div>

      {isCreating && (
        <div className="glass-panel create-skill-panel">
          <form onSubmit={handleCreate} className="create-skill-form">
            <input
              type="text"
              className="cli-input"
              placeholder="Skill Name (e.g. Code Reviewer)"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              autoFocus
            />
            <div className="form-actions">
              <button type="button" className="action-button" onClick={() => setIsCreating(false)}>Cancel</button>
              <button type="submit" className="action-button action-button--primary">Create</button>
            </div>
          </form>
        </div>
      )}

      <div className="server-grid">
        {skills.map((skill) => (
          <div key={skill.id} className="server-card glass-panel" onClick={() => setSelectedSkillId(skill.id)}>
            <div className="server-card-header">
              <div className="server-card-title-row">
                <span className="material-symbols-outlined server-icon">psychology</span>
                <h3 className="server-name">{skill.id}</h3>
              </div>
              <button 
                className="delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete skill "${skill.id}"?`)) {
                    deleteSkill(skill.id);
                  }
                }}
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
            <div className="server-card-body">
              <p className="server-target">Markdown Instruction</p>
            </div>
          </div>
        ))}
        {skills.length === 0 && !isCreating && (
          <div className="empty-state">
            <p>No skills created yet. Create your first shared agent skill.</p>
          </div>
        )}
      </div>
    </div>
  );
}
