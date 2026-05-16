import { useState, useEffect } from "react";

interface SkillEditorProps {
  skill: { id: string; content: string };
  onSave: (id: string, content: string) => Promise<boolean>;
  onBack: () => void;
}

export function SkillEditor({ skill, onSave, onBack }: SkillEditorProps) {
  const [content, setContent] = useState(skill.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(skill.content);
  }, [skill]);

  const handleSave = async () => {
    setSaving(true);
    const success = await onSave(skill.id, content);
    setSaving(false);
    if (success) {
      onBack();
    }
  };

  return (
    <div className="skill-editor">
      <div className="page-header">
        <div className="page-header-left">
          <button className="back-button" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="page-title">Edit Skill: {skill.id}</h1>
        </div>
        <div className="page-header-actions">
          <button 
            className="action-button action-button--primary" 
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Skill"}
          </button>
        </div>
      </div>

      <div className="skill-editor-content glass-panel">
        <textarea
          className="skill-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter skill instructions (Markdown)..."
        />
      </div>
    </div>
  );
}
