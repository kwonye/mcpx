import { useState } from "react";
import { Copy, Download, RotateCw } from "lucide-react";
import type { TelemetryStatus } from "@mcpx/core";
import { Button, IconButton, InlineAlert, Section, SettingRow, SkeletonList, StatusLabel, Switch, useToast } from "../../components/ui";
import type { DesktopSettings } from "../../../shared/desktop-settings";
import type { SecretBackendKind, UpdateCheckResult } from "../../../shared/ipc-contract";
import { DESKTOP_PRODUCT_NAME } from "../../../shared/build-constants";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { setQueryData, useMutation, useQuery, invalidate } from "../../lib/query";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { TELEMETRY_KEY, useTelemetryStatus } from "../../shell/FirstRunNotice";
import { refreshStatus, useStatus } from "../../hooks/useServers";
import "./SettingsView.css";

const SETTINGS_KEY = "desktop-settings";

export function SettingsView() {
  const settings = useQuery<DesktopSettings>(SETTINGS_KEY, () => api().settings.get());
  const telemetry = useTelemetryStatus();

  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        {Boolean(settings.error) && !settings.data && (
          <InlineAlert tone="danger" title="Couldn't load settings" action={<Button size="sm" icon={RotateCw} onClick={() => void settings.refetch()}>Try again</Button>}>
            {errorMessage(settings.error)}
          </InlineAlert>
        )}
        {settings.loading ? <SkeletonList rows={3} label="Loading settings" /> : settings.data && (
          <>
            <GeneralSection settings={settings.data} />
            <SecretsSection />
            <PrivacySection status={telemetry.data} />
            <UpdatesSection settings={settings.data} />
            <AdvancedSection />
          </>
        )}
      </PageBody>
    </>
  );
}

function useSettingToggle(key: "startOnLoginEnabled" | "errorNotificationsEnabled" | "autoUpdateEnabled") {
  return useMutation(async (value: boolean) => {
    setQueryData<DesktopSettings>(SETTINGS_KEY, (current) => current && { ...current, [key]: value });
    try {
      const next = await api().settings.update({ [key]: value });
      setQueryData<DesktopSettings>(SETTINGS_KEY, () => next);
    } catch (error) {
      setQueryData<DesktopSettings>(SETTINGS_KEY, (current) => current && { ...current, [key]: !value });
      throw error;
    }
  });
}

function GeneralSection({ settings }: { settings: DesktopSettings }) {
  const login = useSettingToggle("startOnLoginEnabled");
  const notify = useSettingToggle("errorNotificationsEnabled");
  return (
    <Section title="General">
      <SettingRow
        label="Start at login"
        description={`Open ${DESKTOP_PRODUCT_NAME} in the background when you sign in, so your servers are always available.`}
        control={<Switch checked={settings.startOnLoginEnabled} busy={login.pending} label="Start at login" onCheckedChange={(value) => void login.run(value)} />}
      >
        {login.error && <InlineAlert tone="danger" onDismiss={login.reset}>{login.error}</InlineAlert>}
      </SettingRow>
      <SettingRow
        label="Notifications"
        description="Tell me when a server stops working or needs me to sign in again."
        control={<Switch checked={settings.errorNotificationsEnabled} busy={notify.pending} label="Notifications" onCheckedChange={(value) => void notify.run(value)} />}
      >
        {notify.error && <InlineAlert tone="danger" onDismiss={notify.reset}>{notify.error}</InlineAlert>}
      </SettingRow>
    </Section>
  );
}

const SECRET_BACKEND_KEY = "secret-backend";

function SecretsSection() {
  const toast = useToast();
  const backend = useQuery<SecretBackendKind>(SECRET_BACKEND_KEY, () => api().secrets.backend());
  const change = useMutation(async (useKeychain: boolean) => {
    const result = await api().secrets.setBackend(useKeychain ? "keychain" : "file");
    setQueryData<SecretBackendKind>(SECRET_BACKEND_KEY, () => result.backend);
    if (result.changed) {
      toast.success(
        result.backend === "keychain" ? "Secrets moved to the system keychain" : "Secrets moved to the encrypted file",
        result.migrated.length > 0 ? `${result.migrated.length} moved.` : undefined
      );
    }
  });
  const store = platformStoreName();

  return (
    <Section title="Secrets">
      <SettingRow
        label={`Use ${store}`}
        description={`Keep tokens and API keys in ${store}, which protects them with your login and may ask for permission. Off keeps them in an encrypted file on this computer that needs no prompts.`}
        control={
          <Switch
            checked={backend.data === "keychain"}
            disabled={backend.data === undefined}
            busy={change.pending}
            label={`Use ${store}`}
            onCheckedChange={(value) => void change.run(value)}
          />
        }
      >
        {Boolean(backend.error) && <InlineAlert tone="warning">Couldn't read where secrets are stored: {errorMessage(backend.error)}</InlineAlert>}
        {change.error && <InlineAlert tone="danger" onDismiss={change.reset}>{change.error}</InlineAlert>}
      </SettingRow>
    </Section>
  );
}

function platformStoreName(): string {
  const value = window.mcpx?.platform;
  if (value === "darwin") return "the macOS Keychain";
  if (value === "win32") return "the system credential store";
  return "the system keyring";
}

function PrivacySection({ status }: { status: TelemetryStatus | undefined }) {
  const toast = useToast();
  const update = useMutation(async (patch: { usageAnalyticsEnabled?: boolean; errorReportingEnabled?: boolean }) => {
    setQueryData<TelemetryStatus>(TELEMETRY_KEY, (current) => current && { ...current, ...patch });
    try {
      await api().telemetry.updatePreferences(patch);
    } finally {
      await invalidate(TELEMETRY_KEY);
    }
  });
  const reset = useMutation(async () => {
    await api().telemetry.resetId();
    await invalidate(TELEMETRY_KEY);
    toast.success("Anonymous ID reset");
  });
  const blocked = status?.blockedReason === "environment";

  return (
    <Section
      title="Privacy & diagnostics"
      description={<>Never includes server names, prompts, URLs, file paths or secrets. <a href="https://github.com/kwonye/mcpx/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy policy</a></>}
    >
      {blocked && <div className="settings__note"><InlineAlert>Diagnostics are turned off by an environment variable on this computer.</InlineAlert></div>}
      <SettingRow
        label="Anonymous usage analytics"
        description="Which features are used and how reliably they work."
        control={<Switch checked={Boolean(status?.usageAnalyticsEnabled)} disabled={!status || blocked} busy={update.pending} label="Anonymous usage analytics" onCheckedChange={(value) => void update.run({ usageAnalyticsEnabled: value })} />}
      />
      <SettingRow
        label="Crash reports"
        description="Sanitized error stacks and native crash dumps. Crash dumps may contain fragments of memory."
        control={<Switch checked={Boolean(status?.errorReportingEnabled)} disabled={!status || blocked} busy={update.pending} label="Crash reports" onCheckedChange={(value) => void update.run({ errorReportingEnabled: value })} />}
      >
        {update.error && <InlineAlert tone="danger" onDismiss={update.reset}>{update.error}</InlineAlert>}
      </SettingRow>
      <SettingRow
        label="Anonymous ID"
        description="Start over with a new random ID."
        control={<Button size="sm" loading={reset.pending} onClick={() => void reset.run()} disabled={!status}>Reset ID</Button>}
      >
        {reset.error && <InlineAlert tone="danger" onDismiss={reset.reset}>{reset.error}</InlineAlert>}
      </SettingRow>
    </Section>
  );
}

const UPDATE_TONE: Record<string, "info" | "success" | "warning" | "danger"> = {
  "up-to-date": "success",
  available: "info",
  downloaded: "success",
  error: "danger",
  unsupported: "warning"
};

function UpdatesSection({ settings }: { settings: DesktopSettings }) {
  const auto = useSettingToggle("autoUpdateEnabled");
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const check = useMutation(async () => {
    setResult(null);
    setResult(await api().app.checkForUpdates());
  });
  const fallback: Record<string, string> = {
    "up-to-date": "You're on the latest version.",
    available: "An update is downloading.",
    downloaded: `An update is ready. It installs the next time ${DESKTOP_PRODUCT_NAME} restarts.`,
    error: "Couldn't check for updates.",
    unsupported: "Updates aren't available for this build."
  };
  return (
    <Section title="Updates">
      <SettingRow
        label="Update automatically"
        description="Download new versions in the background and install them on restart."
        control={<Switch checked={settings.autoUpdateEnabled} busy={auto.pending} label="Update automatically" onCheckedChange={(value) => void auto.run(value)} />}
      >
        {auto.error && <InlineAlert tone="danger" onDismiss={auto.reset}>{auto.error}</InlineAlert>}
      </SettingRow>
      <SettingRow
        label="Check now"
        description="Look for a newer version right away."
        control={<Button size="sm" icon={Download} loading={check.pending} onClick={() => void check.run()}>Check for updates</Button>}
      >
        {check.error && <InlineAlert tone="danger" onDismiss={check.reset}>{check.error}</InlineAlert>}
        {result && (
          <InlineAlert tone={UPDATE_TONE[result.status] ?? "info"} onDismiss={() => setResult(null)}>
            {result.message || fallback[result.status] || result.status}
          </InlineAlert>
        )}
      </SettingRow>
    </Section>
  );
}

function AdvancedSection() {
  const status = useStatus();
  const toast = useToast();
  const daemon = status.data?.daemon;
  const restart = useMutation(async () => {
    try {
      await api().gateway.restart();
      toast.success("Gateway restarted");
    } finally {
      await refreshStatus();
    }
  });

  return (
    <Section title="Advanced" description="Details for troubleshooting the local gateway.">
      <SettingRow
        label="Gateway"
        description={daemon?.running ? `Listening on port ${daemon.port ?? "unknown"}${daemon.pid ? ` · process ${daemon.pid}` : ""}` : "Not running"}
        control={
          <>
            <StatusLabel tone={daemon?.running ? "success" : "neutral"}>{daemon?.running ? "Running" : "Stopped"}</StatusLabel>
            <Button size="sm" icon={RotateCw} loading={restart.pending} onClick={() => void restart.run()}>Restart</Button>
          </>
        }
      >
        {daemon?.portMismatch && <InlineAlert tone="warning">The gateway is running on a different port than your settings. Restart it to apply.</InlineAlert>}
        {restart.error && <InlineAlert tone="danger" onDismiss={restart.reset}>{restart.error}</InlineAlert>}
      </SettingRow>
      {status.data?.gatewayUrl && (
        <SettingRow
          label="Gateway address"
          description={<span className="mono selectable">{status.data.gatewayUrl}</span>}
          control={
            <IconButton
              icon={Copy}
              label="Copy gateway address"
              onClick={() => {
                void navigator.clipboard?.writeText(status.data?.gatewayUrl ?? "").then(() => toast.success("Copied"), () => toast.error("Couldn't copy"));
              }}
            />
          }
        />
      )}
      {daemon?.logFile && (
        <SettingRow label="Log file" description={<span className="mono selectable">{daemon.logFile}</span>} control={null} />
      )}
    </Section>
  );
}
