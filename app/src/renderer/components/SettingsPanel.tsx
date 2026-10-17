import { useEffect, useState } from "react";
import type { DesktopSettings } from "../../shared/desktop-settings";
import type { TelemetryStatus } from "@mcpx/core";
import { Toggle } from "./ui";
import { DESKTOP_PRODUCT_NAME } from "../../shared/build-constants";

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
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null);
  const [savingTelemetry, setSavingTelemetry] = useState(false);
  const [telemetryMessage, setTelemetryMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([window.mcpx.getDesktopSettings(), window.mcpx.getTelemetryStatus?.()])
      .then(([loaded, status]) => {
        setSettings(loaded);
        if (status) setTelemetry(status);
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

  const onTelemetryToggle = async (key: "usageAnalyticsEnabled" | "errorReportingEnabled", nextValue: boolean) => {
    if (!telemetry) return;
    const previous = telemetry;
    setSavingTelemetry(true);
    setTelemetryMessage(null);
    setTelemetry({ ...telemetry, [key]: nextValue });
    try {
      const updated = await window.mcpx.updateTelemetryPreferences?.({ [key]: nextValue });
      if (updated) {
        const refreshed = await window.mcpx.getTelemetryStatus?.();
        setTelemetry(refreshed ?? { ...previous, [key]: nextValue });
      }
    } catch (saveError) {
      setTelemetry(previous);
      setTelemetryMessage(formatError(saveError));
    } finally {
      setSavingTelemetry(false);
    }
  };

  const handleResetTelemetryId = async () => {
    setSavingTelemetry(true);
    setTelemetryMessage(null);
    try {
      await window.mcpx.resetTelemetryId?.();
      const refreshed = await window.mcpx.getTelemetryStatus?.();
      if (refreshed) setTelemetry(refreshed);
      setTelemetryMessage("Anonymous installation ID reset.");
    } catch (resetError) {
      setTelemetryMessage(formatError(resetError));
    } finally {
      setSavingTelemetry(false);
    }
  };

  if (!settings) {
    return <div className="empty-state">Loading settings...</div>;
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
    <section className="settings-panel">
      <div className="settings-panel__header">
        <span className="material-symbols-outlined" style={{ color: "var(--primary)" }}>tune</span>
        <h2>General Settings</h2>
      </div>

      <div className="setting-card">
        <div className="setting-card__item">
          <div>
            <span className="setting-card__label">Start on login</span>
            <p className="setting-card__description">Launch in the tray when you log in.</p>
          </div>
          <Toggle
            id="toggle-startOnLogin"
            checked={settings.startOnLoginEnabled}
            onChange={(checked) => onToggle("startOnLoginEnabled", checked)}
            disabled={busy}
            label="Start on login"
          />
        </div>
      </div>

      <div className="setting-card">
        <div className="setting-card__item">
          <div>
            <span className="setting-card__label">Error notifications</span>
            <p className="setting-card__description">Show a macOS notification when an MCP server starts failing or needs re-authentication.</p>
          </div>
          <Toggle
            id="toggle-errorNotifications"
            checked={settings.errorNotificationsEnabled}
            onChange={(checked) => onToggle("errorNotificationsEnabled", checked)}
            disabled={busy}
            label="Error notifications"
          />
        </div>
      </div>

      <div className="setting-card setting-card--grouped">
        <h3 className="setting-card__group-title">Privacy &amp; diagnostics</h3>
        {telemetry && (
          <>
            <div className="setting-card__item">
              <div>
                <span className="setting-card__label">Anonymous usage analytics</span>
                <p className="setting-card__description">Feature usage and bucketed reliability counts. No names, prompts, results, paths, URLs, or secrets.</p>
              </div>
              <Toggle
                id="toggle-usageAnalytics"
                checked={telemetry.usageAnalyticsEnabled}
                onChange={(checked) => void onTelemetryToggle("usageAnalyticsEnabled", checked)}
                disabled={savingTelemetry}
                label="Anonymous usage analytics"
              />
            </div>
            <div className="setting-card__item">
              <div>
                <span className="setting-card__label">Anonymous crash diagnostics</span>
                <p className="setting-card__description">Sanitized JavaScript stacks and automatic native crash minidumps. Minidumps may contain memory fragments and cannot be guaranteed anonymous.</p>
              </div>
              <Toggle
                id="toggle-errorReporting"
                checked={telemetry.errorReportingEnabled}
                onChange={(checked) => void onTelemetryToggle("errorReportingEnabled", checked)}
                disabled={savingTelemetry}
                label="Anonymous crash diagnostics"
              />
            </div>
            <div className="setting-card__item setting-card__item--stacked">
              <div>
                <span className="setting-card__label">Reset anonymous identity</span>
                <p className="setting-card__description">Create a new random installation ID and restart analytics milestones.</p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => void handleResetTelemetryId()} disabled={savingTelemetry}>Reset ID</button>
            </div>
            <p className="setting-card__description">Read the full <a href="https://github.com/kwonye/mcpx/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">mcpx privacy policy</a>.</p>
          </>
        )}
      </div>

      <div className="setting-card setting-card--grouped">
        <h3 className="setting-card__group-title">Updates</h3>
        <div className="setting-card__item">
          <div>
            <span className="setting-card__label">Auto-update</span>
            <p className="setting-card__description">Automatically download updates from GitHub Releases.</p>
          </div>
          <Toggle
            id="toggle-autoUpdate"
            checked={settings.autoUpdateEnabled}
            onChange={(checked) => onToggle("autoUpdateEnabled", checked)}
            disabled={busy}
            label="Auto-update"
          />
        </div>
        <div className="setting-card__item setting-card__item--stacked">
          <div>
            <span className="setting-card__label">Manual check</span>
            <p className="setting-card__description">Check for app updates now. Any downloaded update will install the next time you restart {DESKTOP_PRODUCT_NAME}.</p>
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
      </div>

      {error && <div className="feedback-message error">{error}</div>}
      {telemetryMessage && <div className="feedback-message success">{telemetryMessage}</div>}
      {updateMessage && <div className="feedback-message success">{updateMessage}</div>}
    </section>
  );
}
