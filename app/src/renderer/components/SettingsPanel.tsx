import { useEffect, useState } from "react";
import type { DesktopSettings } from "../../shared/desktop-settings";

type SettingKey = keyof DesktopSettings;

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save settings.";
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [savingKey, setSavingKey] = useState<SettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.mcpx.getDesktopSettings()
      .then((loaded) => {
        setSettings(loaded);
      })
      .catch((loadError) => {
        setError(formatError(loadError));
      });
  }, []);

  const onToggle = async (key: SettingKey, nextValue: boolean) => {
    if (!settings) {
      return;
    }

    const previous = settings;
    setError(null);
    setSavingKey(key);
    setSettings({
      ...settings,
      [key]: nextValue
    });

    try {
      const updated = await window.mcpx.updateDesktopSettings({ [key]: nextValue });
      setSettings(updated);
    } catch (saveError) {
      setSettings(previous);
      setError(formatError(saveError));
    } finally {
      setSavingKey(null);
    }
  };

  if (!settings) {
    return <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px" }}>Loading settings...</div>;
  }

  const busy = savingKey !== null;

  return (
    <section className="glass-panel" style={{ borderRadius: "16px", padding: "32px", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--primary)" }}>tune</span>
        <h2 style={{ fontSize: "20px", fontWeight: 600, color: "var(--text-main)" }}>General Settings</h2>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", paddingBottom: "24px", borderBottom: "1px solid rgba(255, 255, 255, 0.4)" }}>
        <div style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: "16px", fontWeight: 500, color: "var(--text-main)", marginBottom: "4px" }}>Auto-update</span>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Automatically download updates from GitHub Releases.</p>
        </div>
        <div style={{ position: "relative", display: "inline-block", width: "44px", marginRight: "8px", verticalAlign: "middle", userSelect: "none", transition: "duration 200ms ease-in" }}>
          <input
            type="checkbox"
            className="toggle-checkbox"
            id="toggle-autoUpdate"
            style={{ position: "absolute", display: "block", width: "24px", height: "24px", borderRadius: "50%", background: "white", border: "4px solid transparent", appearance: "none", cursor: "pointer", zIndex: 10, top: 0, left: 0, transition: "all 150ms ease-out", opacity: 0 }}
            checked={settings.autoUpdateEnabled}
            onChange={(event) => onToggle("autoUpdateEnabled", event.target.checked)}
            disabled={busy}
          />
          <label className="toggle-label" htmlFor="toggle-autoUpdate" style={{ display: "block", overflow: "hidden", height: "24px", borderRadius: "9999px", cursor: "pointer", transition: "colors 150ms ease-out" }}></label>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", paddingBottom: "8px" }}>
        <div style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: "16px", fontWeight: 500, color: "var(--text-main)", marginBottom: "4px" }}>Start on login</span>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Launch in the tray when you log in.</p>
        </div>
        <div style={{ position: "relative", display: "inline-block", width: "44px", marginRight: "8px", verticalAlign: "middle", userSelect: "none", transition: "duration 200ms ease-in" }}>
          <input
            type="checkbox"
            className="toggle-checkbox"
            id="toggle-startOnLogin"
            style={{ position: "absolute", display: "block", width: "24px", height: "24px", borderRadius: "50%", background: "white", border: "4px solid transparent", appearance: "none", cursor: "pointer", zIndex: 10, top: 0, left: 0, transition: "all 150ms ease-out", opacity: 0 }}
            checked={settings.startOnLoginEnabled}
            onChange={(event) => onToggle("startOnLoginEnabled", event.target.checked)}
            disabled={busy}
          />
          <label className="toggle-label" htmlFor="toggle-startOnLogin" style={{ display: "block", overflow: "hidden", height: "24px", borderRadius: "9999px", cursor: "pointer", transition: "colors 150ms ease-out" }}></label>
        </div>
      </div>

      {error && <div style={{ color: "var(--error)", fontSize: "14px", padding: "12px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.2)" }}>{error}</div>}
    </section>
  );
}
