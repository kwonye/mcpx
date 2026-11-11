import { useEffect, useMemo, useState } from "react";
import { AppWindow, RefreshCw, RotateCw, ScanSearch } from "lucide-react";
import type { StatusReport } from "@mcpx/core";
import { Badge, Button, InlineAlert, List, ListRow, Menu, Section, SkeletonList, StatusLabel, useToast } from "../../components/ui";
import type { AdoptionPlan, HarnessInstallation, SyncMode } from "../../../shared/ipc-contract";
import { api } from "../../lib/api";
import { CLIENT_NAMES, clientName, deriveClientState, type ClientState } from "../../lib/domain";
import { errorMessage } from "../../lib/errors";
import { plural, relativeTime, tildify } from "../../lib/format";
import { invalidate, useMutation } from "../../lib/query";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { useNavigation } from "../../shell/navigation";
import { refreshStatus, useStatus } from "../../hooks/useServers";
import { MANAGEMENT_KEY, useManagementSnapshot } from "../../hooks/useManagement";
import { AdoptionDialog } from "./AdoptionDialog";
import { ActivitySection } from "./ActivitySection";
import "./ClientsView.css";

export interface ClientEntry {
  id: string;
  name: string;
  state: ClientState;
  detected: boolean;
  scope?: "global" | "project";
  projectPath?: string;
  mode?: SyncMode;
  lastSyncAt?: string;
  configPath?: string;
  serverCount: number;
  harnessId?: string;
}

type ClientConfig = { status?: string; message?: string; lastSyncAt?: string; configPath?: string } | undefined;

function serverCountFor(report: StatusReport | undefined, clientId: string): number {
  return (report?.servers ?? []).filter((server) => server.clients.some((client) => client.clientId === clientId && client.managed)).length;
}

/** Preferred source: harness installations from the management service. */
export function entriesFromHarnesses(harnesses: HarnessInstallation[], report?: StatusReport): ClientEntry[] {
  return harnesses.map((harness) => {
    const sync = harness.sync as ClientConfig;
    let state = harness.detected ? deriveClientState(sync) : deriveClientState({ status: "SKIPPED" });
    if (harness.detected && harness.mode === "observe" && !sync) {
      state = { label: "Watching only", tone: "neutral", managed: false, detail: "mcpx doesn't change this app's settings." };
    }
    return {
      id: harness.id,
      harnessId: harness.id,
      name: harness.label || clientName(harness.harness),
      state,
      detected: harness.detected,
      scope: harness.scope,
      projectPath: harness.projectPath,
      mode: harness.mode,
      lastSyncAt: sync?.lastSyncAt,
      configPath: harness.configPath ?? undefined,
      serverCount: serverCountFor(report, harness.harness)
    };
  });
}

/** Fallback when the management service is unreachable: the status report's client list. */
export function entriesFromStatus(report: StatusReport): ClientEntry[] {
  const ids = new Set<string>([...Object.keys(CLIENT_NAMES), ...Object.keys(report.clients ?? {})]);
  for (const server of report.servers) for (const client of server.clients) ids.add(client.clientId);
  return [...ids].map((id) => {
    const config = (report.clients as Record<string, ClientConfig>)[id];
    return {
      id,
      name: clientName(id),
      state: deriveClientState(config),
      detected: config?.status !== "SKIPPED",
      lastSyncAt: config?.lastSyncAt,
      configPath: config?.configPath,
      serverCount: serverCountFor(report, id)
    };
  });
}

export const MODE_LABEL: Record<SyncMode, string> = {
  automatic: "Manage automatically",
  selected: "Manage what I pick",
  observe: "Watch only"
};

export function ClientsView() {
  const status = useStatus();
  const snapshot = useManagementSnapshot();
  const toast = useToast();
  const [plan, setPlan] = useState<AdoptionPlan | null>(null);
  const [failures, setFailures] = useState<Array<{ clientId: string; message?: string }>>([]);

  const entries = useMemo(() => {
    if (snapshot.data) return entriesFromHarnesses(snapshot.data.harnesses, status.data);
    return status.data ? entriesFromStatus(status.data) : [];
  }, [snapshot.data, status.data]);
  const installed = entries.filter((entry) => entry.detected).sort((a, b) => a.name.localeCompare(b.name));
  const missing = entries.filter((entry) => !entry.detected).sort((a, b) => a.name.localeCompare(b.name));

  const sync = useMutation(async () => {
    setFailures([]);
    const summary = await api().status.syncAll();
    await Promise.all([refreshStatus(), invalidate(MANAGEMENT_KEY)]);
    const failed = summary.results.filter((result) => result.status === "ERROR");
    setFailures(failed);
    const synced = summary.results.filter((result) => result.status === "SYNCED").length;
    if (failed.length === 0) toast.success("Sync complete", synced > 0 ? `${plural(synced, "app")} up to date. Restart open apps to pick up changes.` : undefined);
  });

  const scan = useMutation(async (harnesses?: string[]) => {
    setPlan(await api().management.planAdoption(harnesses));
  });
  const { intent, clearIntent } = useNavigation();
  useEffect(() => {
    if (intent?.type !== "find-existing") return;
    clearIntent();
    void scan.run();
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const nothingYet = !snapshot.data && !status.data;
  const failed = nothingYet && Boolean(snapshot.error) && Boolean(status.error);

  return (
    <>
      <PageHeader
        title="Clients"
        description="The AI apps on this computer that mcpx keeps connected to your servers and skills."
        actions={
          <>
            <Button icon={ScanSearch} loading={scan.pending} onClick={() => void scan.run()}>Find existing setups</Button>
            <Button variant="primary" icon={RefreshCw} loading={sync.pending} onClick={() => void sync.run()}>Sync now</Button>
          </>
        }
      />
      <PageBody>
        <div className="view-stack">
          {sync.error && <InlineAlert tone="danger" title="Sync didn't finish" onDismiss={sync.reset}>{sync.error}</InlineAlert>}
          {scan.error && <InlineAlert tone="danger" title="Couldn't look for existing setups" onDismiss={scan.reset}>{scan.error}</InlineAlert>}
          {failures.length > 0 && (
            <InlineAlert tone="warning" title={`${plural(failures.length, "app")} couldn't be updated`} onDismiss={() => setFailures([])}>
              {failures.map((failure) => `${clientName(failure.clientId)}: ${failure.message ?? "unknown error"}`).join(" · ")}
            </InlineAlert>
          )}
          {Boolean(snapshot.error) && !snapshot.data && status.data && (
            <InlineAlert tone="warning" title="The background service isn't responding" action={<Button size="sm" icon={RotateCw} onClick={() => void snapshot.refetch()}>Retry</Button>}>
              Showing what mcpx last knew. {errorMessage(snapshot.error)}
            </InlineAlert>
          )}
          {failed ? (
            <InlineAlert tone="danger" title="Couldn't reach mcpx" action={<Button size="sm" icon={RotateCw} onClick={() => { void status.refetch(); void snapshot.refetch(); }}>Try again</Button>}>
              {errorMessage(snapshot.error)}
            </InlineAlert>
          ) : nothingYet ? (
            <SkeletonList rows={5} label="Loading apps" />
          ) : (
            <>
              <Section title="On this computer" description="mcpx writes your servers and skills into these apps." variant="plain">
                {installed.length > 0 ? (
                  <List label="Installed apps">
                    {installed.map((entry) => <ClientRow key={entry.id} entry={entry} onScan={() => void scan.run(entry.harnessId ? [entry.harnessId] : undefined)} />)}
                  </List>
                ) : (
                  <p className="text-muted">No supported apps found yet. Install one, then choose Sync now.</p>
                )}
              </Section>
              {missing.length > 0 && (
                <Section title="Not installed" description="Supported apps mcpx didn't find. They're set up once installed." variant="plain">
                  <List label="Apps not installed">{missing.map((entry) => <ClientRow key={entry.id} entry={entry} />)}</List>
                </Section>
              )}
              {snapshot.data && <ActivitySection operations={snapshot.data.operations} />}
            </>
          )}
        </div>
      </PageBody>
      {plan && <AdoptionDialog plan={plan} onClose={() => setPlan(null)} />}
    </>
  );
}

function ClientRow({ entry, onScan }: { entry: ClientEntry; onScan?: () => void }) {
  const toast = useToast();
  const synced = relativeTime(entry.lastSyncAt);
  const setMode = useMutation(async (mode: SyncMode) => {
    if (!entry.harnessId) return;
    await api().management.setHarnessMode(entry.harnessId, mode);
    await invalidate(MANAGEMENT_KEY);
    toast.success(`${entry.name}: ${MODE_LABEL[mode].toLowerCase()}`);
  });

  const subtitle = entry.detected
    ? [entry.serverCount > 0 ? plural(entry.serverCount, "server") : "No servers yet", synced ? `synced ${synced}` : null].filter(Boolean).join(" · ")
    : entry.state.detail;
  const location = entry.projectPath ? `${tildify(entry.projectPath)} · ${tildify(entry.configPath ?? "")}` : entry.configPath ? tildify(entry.configPath) : null;

  return (
    <ListRow
      tone={entry.detected ? "default" : "muted"}
      leading={<span className="row-icon"><AppWindow size={15} strokeWidth={1.75} /></span>}
      title={<>{entry.name}{entry.scope === "project" && <Badge>Project</Badge>}</>}
      subtitle={subtitle}
      meta={<StatusLabel tone={entry.state.tone}>{entry.state.label}</StatusLabel>}
      trailing={entry.detected && entry.harnessId ? (
        <>
          <label className="client-mode">
            <span className="visually-hidden">How mcpx manages {entry.name}</span>
            <select value={entry.mode} disabled={setMode.pending} onChange={(event) => void setMode.run(event.target.value as SyncMode)}>
              {(Object.keys(MODE_LABEL) as SyncMode[]).map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
            </select>
          </label>
          {onScan && <Menu label={`More actions for ${entry.name}`} size="sm" items={[{ label: "Find existing setup", icon: ScanSearch, onSelect: onScan }]} />}
        </>
      ) : undefined}
    >
      {setMode.error && <InlineAlert tone="danger" onDismiss={setMode.reset}>{setMode.error}</InlineAlert>}
      {entry.state.tone === "danger" && entry.state.detail && <p className="row-note row-note--danger">{entry.state.detail}</p>}
      {entry.detected && location && <p className="row-note mono-subtle" title={entry.configPath}>{location}</p>}
    </ListRow>
  );
}
