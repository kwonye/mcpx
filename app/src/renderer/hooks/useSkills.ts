import { useCallback, useEffect, useState } from "react";
import type { Skill } from "@mcpx/core";

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.mcpx.skills.list();
      setSkills(result);
      setError(null);
    } catch (e) {
      console.error("Failed to list skills:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveSkill = async (id: string, content: string) => {
    try {
      await window.mcpx.skills.save(id, content);
      await refresh();
      return true;
    } catch (e) {
      console.error("Failed to save skill:", e);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const deleteSkill = async (id: string) => {
    try {
      await window.mcpx.skills.delete(id);
      await refresh();
      return true;
    } catch (e) {
      console.error("Failed to delete skill:", e);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const customizeSkill = async (id: string, name?: string) => {
    try { await window.mcpx.skills.customize(id, name); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };

  const updateSkill = async (id: string) => {
    try { await window.mcpx.skills.update(id); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };

  const rollbackSkill = async (id: string) => {
    try { await window.mcpx.skills.rollback(id); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };

  return { skills, loading, error, refresh, saveSkill, deleteSkill, customizeSkill, updateSkill, rollbackSkill };
}
