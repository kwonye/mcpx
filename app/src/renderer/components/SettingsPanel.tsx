import { useEffect, useState } from "react";
import type { DesktopSettings } from "../../shared/desktop-settings";
import { Toggle } from "./ui";

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
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

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
    setUpdateMessage(null);
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
    return <div className="browse-empty">Loading settings...</div>;
  }

  const busy = savingKey !== null;

  const handleCheckForUpdates = async () => {
    setError(null);
    setUpdateMessage(null);
    setCheckingForUpdates(true);

    try {
      const result = await window.mcpx.checkForUpdates();
      setUpdateMessage(result.message);
    } catch (checkError) {
      setError(formatError(checkError));
    } finally {
      setCheckingForUpdates(false);
    }
  };

  return (
    <section className="glass-panel settings-panel">
      <div className="settings-panel__header">
        <span className="material-symbols-outlined" style={{ color: "var(--primary)" }}>tune</span>
        <h2>General Settings</h2>
      </div>

      <div className="settings-panel__item">
        <div>
          <span className="settings-panel__label">Auto-update</span>
          <p className="settings-panel__description">Automatically download updates from GitHub Releases.</p>
        </div>
        <Toggle
          id="toggle-autoUpdate"
          checked={settings.autoUpdateEnabled}
          onChange={(checked) => onToggle("autoUpdateEnabled", checked)}
          disabled={busy}
          label="Auto-update"
        />
      </div>

      <div className="settings-panel__item">
        <div>
          <span className="settings-panel__label">Start on login</span>
          <p className="settings-panel__description">Launch in the tray when you log in.</p>
        </div>
        <Toggle
          id="toggle-startOnLogin"
          checked={settings.startOnLoginEnabled}
          onChange={(checked) => onToggle("startOnLoginEnabled", checked)}
          disabled={busy}
          label="Start on login"
        />
      </div>

      <div className="settings-panel__item settings-panel__item--stacked">
        <div>
          <span className="settings-panel__label">Updates</span>
          <p className="settings-panel__description">Check for app updates now. Any downloaded update will install the next time you restart mcpx.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCheckForUpdates}
          disabled={checkingForUpdates}
        >
          {checkingForUpdates ? "Checking..." : "Check for Updates"}
        </button>
      </div>

      {error && <div className="feedback-message error">{error}</div>}
      {updateMessage && <div className="feedback-message success">{updateMessage}</div>}
    </section>
  );
}
