import { useCallback, useState } from "react";

export function useServerEnabled(serverName: string, onRefresh: () => void) {
  const [isToggling, setIsToggling] = useState(false);

  const handleEnabledChange = useCallback(async (enabled: boolean) => {
    setIsToggling(true);
    try {
      await window.mcpx.setServerEnabled(serverName, enabled);
      onRefresh();
    } catch (error) {
      alert(`Failed to ${enabled ? "enable" : "disable"} server: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsToggling(false);
    }
  }, [onRefresh, serverName]);

  return { isToggling, handleEnabledChange };
}
