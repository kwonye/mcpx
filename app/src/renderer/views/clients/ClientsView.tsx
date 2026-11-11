import { useMemo, useState } from "react";
import { AppWindow, RefreshCw, RotateCw } from "lucide-react";
import type { StatusReport } from "@mcpx/core";
import { Button, InlineAlert, List, ListRow, Section, SkeletonList, StatusLabel, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { CLIENT_NAMES, clientName, deriveClientState, type ClientState } from "../../lib/domain";
import { errorMessage } from "../../lib/errors";
import { plural, relativeTime, tildify } from "../../lib/format";
import { useMutation } from "../../lib/query";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { refreshStatus, useStatus } from "../../hooks/useServers";

interface ClientEntry {
  id: string;
  name: string;
  state: ClientState;
  lastSyncAt?: string;
  configPath?: string;
  serverCount: number;
}

export function buildClientEntries(report: StatusReport): ClientEntry[] {
  const ids = new Set<string>([...Object.keys(CLIENT_NAMES), ...Object.keys(report.clients ?? {})]);
  for (const server of report.servers) for (const client of server.clients) ids.add(client.clientId);
  return [...ids].map((id) => {
    const config = (report.clients as Record<string, { status?: string; message?: string; lastSyncAt?: string; configPath?: string } | undefined>)[id];
    const mappings = report.servers.map((server) => server.clients.find((client) => client.clientId === id)).filter(Boolean);
    return {
      id,
      name: clientName(id),
      state: deriveClientState(config),
      lastSyncAt: config?.lastSyncAt,
      configPath: config?.configPath ?? mappings.find((mapping) => mapping?.configPath)?.configPath,
      serverCount: mappings.filter((mapping) => mapping?.managed).length
    };
  });
}

export function ClientsView() {
  const status = useStatus();
  const toast = useToast();
  const entries = useMemo(() => (status.data ? buildClientEntries(status.data) : []), [status.data]);
  const managed = entries.filter((entry) => entry.state.managed).sort((a, b) => a.name.localeCompare(b.name));
  const others = entries.filter((entry) => !entry.state.managed).sort((a, b) => a.name.localeCompare(b.name));

  const [failures, setFailures] = useState<Array<{ clientId: string; message?: string }>>([]);
  const sync = useMutation(async () => {
    setFailures([]);
    const summary = await api().status.syncAll();
    await refreshStatus();
    const failures = summary.results.filter((result) => result.status === "ERROR");
    const synced = summary.results.filter((result) => result.status === "SYNCED").length;
    setFailures(failures);
    if (failures.length === 0) toast.success("Sync complete", synced > 0 ? `${plural(synced, "app")} up to date.` : undefined);
    return failures;
  });

  return (
    <>
      <PageHeader
        title="Clients"
        description="The AI apps on this computer that mcpx keeps connected to your servers."
        actions={<Button variant="primary" icon={RefreshCw} loading={sync.pending} onClick={() => void sync.run()}>Sync now</Button>}
      />
      <PageBody>
        <div className="view-stack">
          {sync.error && <InlineAlert tone="danger" title="Sync didn't finish" onDismiss={sync.reset}>{sync.error}</InlineAlert>}
          {failures.length > 0 && (
            <InlineAlert tone="warning" title={`${plural(failures.length, "app")} couldn't be updated`}>
              {failures.map((failure) => `${clientName(failure.clientId)}: ${failure.message ?? "unknown error"}`).join(" · ")}
            </InlineAlert>
          )}
          {status.error && !status.data ? (
            <InlineAlert tone="danger" title="Couldn't load your apps" action={<Button size="sm" icon={RotateCw} onClick={() => void status.refetch()}>Try again</Button>}>
              {errorMessage(status.error)}
            </InlineAlert>
          ) : status.loading ? (
            <SkeletonList rows={5} label="Loading apps" />
          ) : (
            <>
              <Section title="Managed by mcpx" description="These apps get every server you turn on." variant="plain">
                {managed.length > 0 ? (
                  <List label="Managed apps">{managed.map((entry) => <ClientRow key={entry.id} entry={entry} />)}</List>
                ) : (
                  <p className="text-muted">No apps yet. Install a supported app, then choose Sync now.</p>
                )}
              </Section>
              {others.length > 0 && (
                <Section title="Other supported apps" description="mcpx will manage these once they're installed and synced." variant="plain">
                  <List label="Other apps">{others.map((entry) => <ClientRow key={entry.id} entry={entry} />)}</List>
                </Section>
              )}
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}

function ClientRow({ entry }: { entry: ClientEntry }) {
  const synced = relativeTime(entry.lastSyncAt);
  const subtitle = entry.state.managed
    ? [entry.serverCount > 0 ? plural(entry.serverCount, "server") : "No servers yet", synced ? `synced ${synced}` : null].filter(Boolean).join(" · ")
    : entry.state.detail;
  return (
    <ListRow
      tone={entry.state.managed ? "default" : "muted"}
      leading={<span className="row-icon"><AppWindow size={15} strokeWidth={1.75} /></span>}
      title={entry.name}
      subtitle={subtitle}
      meta={<StatusLabel tone={entry.state.tone}>{entry.state.label}</StatusLabel>}
    >
      {entry.state.label === "Sync failed" && entry.state.detail && <p className="row-note row-note--danger">{entry.state.detail}</p>}
      {entry.state.managed && entry.configPath && <p className="row-note mono-subtle" title={entry.configPath}>{tildify(entry.configPath)}</p>}
    </ListRow>
  );
}
