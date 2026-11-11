import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { TelemetryStatus } from "@mcpx/core";
import { Button, InlineAlert, SettingRow, Switch } from "../components/ui";
import { api } from "../lib/api";
import { invalidate, useMutation, useQuery } from "../lib/query";

export const TELEMETRY_KEY = "telemetry";

export function useTelemetryStatus() {
  const query = useQuery<TelemetryStatus>(TELEMETRY_KEY, () => api().telemetry.status());
  useEffect(() => api().telemetry.onChanged(() => void invalidate(TELEMETRY_KEY)), []);
  return query;
}

export function needsPrivacyChoice(status: TelemetryStatus | undefined): boolean {
  return Boolean(status && status.noticeAcknowledgedVersion < 1 && status.blockedReason !== "environment");
}

/**
 * Non-blocking first-run privacy notice. Diagnostics stay off until the
 * notice is acknowledged (main enforces that); this only asks once.
 */
export function FirstRunNotice() {
  const { data: status } = useTelemetryStatus();
  const [choosing, setChoosing] = useState(false);
  const [usage, setUsage] = useState(true);
  const [errors, setErrors] = useState(true);

  useEffect(() => {
    if (!status) return;
    setUsage(status.usageAnalyticsEnabled);
    setErrors(status.errorReportingEnabled);
  }, [status?.usageAnalyticsEnabled, status?.errorReportingEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation(async (choices: { usageAnalyticsEnabled: boolean; errorReportingEnabled: boolean }) => {
    // Apply choices before acknowledging so opting out never briefly starts analytics.
    await api().telemetry.updatePreferences(choices);
    await api().telemetry.acknowledge();
    await invalidate(TELEMETRY_KEY);
  });

  if (!needsPrivacyChoice(status)) return null;

  return (
    <div className="first-run">
      <section className="first-run__card" aria-labelledby="first-run-title">
        <div className="first-run__line">
          <ShieldCheck className="first-run__icon" size={18} strokeWidth={1.75} aria-hidden />
          <div className="first-run__text">
            <p id="first-run-title" className="first-run__title">Help improve mcpx</p>
            <p className="first-run__body">
              Send anonymous usage counts and crash reports. Never server names, prompts, URLs, paths or secrets.{" "}
              <a href="https://github.com/kwonye/mcpx/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy policy</a>
            </p>
          </div>
          {!choosing && (
            <div className="first-run__actions">
              <Button size="sm" variant="ghost" onClick={() => setChoosing(true)} disabled={save.pending}>Choose…</Button>
              <Button size="sm" variant="primary" loading={save.pending} onClick={() => void save.run({ usageAnalyticsEnabled: usage, errorReportingEnabled: errors })}>
                Allow
              </Button>
            </div>
          )}
        </div>
        {choosing && (
          <div className="first-run__choices">
            <SettingRow
              label="Anonymous usage analytics"
              description="Which features are used and how reliably, tied to a random ID you can reset."
              control={<Switch checked={usage} onCheckedChange={setUsage} label="Anonymous usage analytics" />}
            />
            <SettingRow
              label="Crash reports"
              description="Sanitized error stacks and native crash dumps. Crash dumps may contain fragments of memory."
              control={<Switch checked={errors} onCheckedChange={setErrors} label="Crash reports" />}
            />
            <div className="first-run__actions" style={{ justifyContent: "flex-end", paddingTop: 8 }}>
              <Button size="sm" variant="primary" loading={save.pending} onClick={() => void save.run({ usageAnalyticsEnabled: usage, errorReportingEnabled: errors })}>
                Save choices
              </Button>
            </div>
          </div>
        )}
        {save.error && <InlineAlert tone="danger">{save.error}</InlineAlert>}
      </section>
    </div>
  );
}
