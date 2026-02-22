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
    return <div className="settings-panel">Loading settings...</div>;
  }

  const busy = savingKey !== null;

  return (
    <section className="settings-panel">
      <div className="settings-row">
        <div className="settings-copy">
          <div className="settings-label">Auto-update</div>
          <div className="settings-description">Automatically download updates from GitHub Releases.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label="Auto-update"
            checked={settings.autoUpdateEnabled}
            onChange={(event) => onToggle("autoUpdateEnabled", event.target.checked)}
            disabled={busy}
          />
          <span className="settings-toggle-track">
            <span className="settings-toggle-thumb" />
          </span>
        </label>
      </div>

      <div className="settings-row">
        <div className="settings-copy">
          <div className="settings-label">Start on login</div>
          <div className="settings-description">Launch in the tray when you log in.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label="Start on login"
            checked={settings.startOnLoginEnabled}
            onChange={(event) => onToggle("startOnLoginEnabled", event.target.checked)}
            disabled={busy}
          />
          <span className="settings-toggle-track">
            <span className="settings-toggle-thumb" />
          </span>
        </label>
      </div>

      {error && <div className="settings-error">{error}</div>}
    </section>
  );
}
