import { useState } from "react";
import type { TelemetryStatus } from "@mcpx/core";
import { Toggle } from "./ui";

interface TelemetryDisclosureProps {
  status: TelemetryStatus;
  onComplete: () => void;
}

export function TelemetryDisclosure({ status, onComplete }: TelemetryDisclosureProps) {
  const [reviewing, setReviewing] = useState(false);
  const [usageEnabled, setUsageEnabled] = useState(status.usageAnalyticsEnabled);
  const [errorsEnabled, setErrorsEnabled] = useState(status.errorReportingEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueWithSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.mcpx.updateTelemetryPreferences?.({
        usageAnalyticsEnabled: usageEnabled,
        errorReportingEnabled: errorsEnabled
      });
      // Apply the reviewed choices before acknowledging so opting out of usage
      // analytics cannot briefly initialize PostHog during this disclosure.
      await window.mcpx.acknowledgeTelemetryNotice?.();
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save privacy settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="telemetry-disclosure">
      <section className="telemetry-disclosure__card glass-card">
        <div className="telemetry-disclosure__icon" aria-hidden="true">
          <span className="material-symbols-outlined">shield_lock</span>
        </div>
        <h1>Help improve mcpx</h1>
        <p>
          mcpx can send anonymous usage analytics and crash diagnostics so we can understand reliability and fix problems faster.
        </p>
        <p>
          We do not collect server names, prompts, results, URLs, file paths, command arguments, environment values, or secrets. Native crash reports may contain fragments of process memory and cannot be guaranteed anonymous.
        </p>

        {reviewing && (
          <div className="telemetry-disclosure__settings">
            <div className="setting-card__item">
              <div>
                <span className="setting-card__label">Anonymous usage analytics</span>
                <p className="setting-card__description">Feature usage and reliability counts using a resettable random installation ID.</p>
              </div>
              <Toggle id="toggle-disclosure-usage" checked={usageEnabled} onChange={setUsageEnabled} disabled={saving} label="Anonymous usage analytics" />
            </div>
            <div className="setting-card__item">
              <div>
                <span className="setting-card__label">Anonymous crash diagnostics</span>
                <p className="setting-card__description">Sanitized JavaScript stacks and automatic native crash minidumps.</p>
              </div>
              <Toggle id="toggle-disclosure-errors" checked={errorsEnabled} onChange={setErrorsEnabled} disabled={saving} label="Anonymous crash diagnostics" />
            </div>
          </div>
        )}

        {error && <div className="feedback-message error">{error}</div>}
        <div className="telemetry-disclosure__actions">
          {!reviewing && (
            <button type="button" className="btn btn-secondary" onClick={() => setReviewing(true)} disabled={saving}>
              Review settings
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void continueWithSettings()} disabled={saving}>
            {saving ? "Saving..." : reviewing ? "Continue with these settings" : "Continue"}
          </button>
        </div>
        <p className="telemetry-disclosure__footer">You can change these choices any time in Settings or with <code>mcpx telemetry</code>.</p>
      </section>
    </main>
  );
}
