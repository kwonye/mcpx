import { useCallback, useEffect, useState } from "react";

export function useSkills() {
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.mcpx.skills.list();
      setSkills(result);
    } catch (e) {
      console.error("Failed to list skills:", e);
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
      return false;
    }
  };

  return { skills, loading, refresh, saveSkill, deleteSkill };
}
