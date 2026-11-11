import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCw, ScanSearch, Server } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, InlineAlert, List, SkeletonList, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatTokens, plural } from "../../lib/format";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { useNavigation } from "../../shell/navigation";
import { refreshStatus, sortByAttention, useServers, type ServerView } from "../../hooks/useServers";
import { AddServerDialog } from "./AddServerDialog";
import { EditServerDialog } from "./EditServerDialog";
import { ServerDetail } from "./ServerDetail";
import { ServerRow } from "./ServerRow";

export function ServersView() {
  const { serverName, openServer, intent, clearIntent, go, request } = useNavigation();
  const { status, servers, tokens, gatewayRunning } = useServers();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ServerView | null>(null);

  useEffect(() => {
    if (intent?.type === "add-server") {
      setAdding(true);
      clearIntent();
    }
  }, [intent, clearIntent]);

  const sorted = useMemo(() => sortByAttention(servers), [servers]);
  const names = servers.map((server) => server.name);
  const editingServer = editing ? servers.find((server) => server.name === editing) ?? null : null;

  async function remove(server: ServerView) {
    await api().servers.remove(server.name);
    setRemoving(null);
    if (serverName === server.name) openServer(null);
    toast.success(`Removed ${server.name}`);
    await refreshStatus();
  }

  const dialogs = (
    <>
      <AddServerDialog open={adding} onClose={() => setAdding(false)} existingNames={names} />
      <EditServerDialog server={editingServer} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "server"}?`}
        message="It will be removed from mcpx and from every app it was synced to. Saved sign-ins for it are deleted."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove(removing) : undefined)}
        onCancel={() => setRemoving(null)}
      />
    </>
  );

  if (serverName) {
    return (
      <>
        <ServerDetail
          server={servers.find((server) => server.name === serverName)}
          loading={status.loading}
          onEdit={(server) => setEditing(server.name)}
          onRemove={setRemoving}
        />
        {dialogs}
      </>
    );
  }

  const enabled = servers.filter((server) => server.enabled);
  const connected = servers.filter((server) => server.state.kind === "connected").length;
  const total = tokens.data?.gatewayRunning && gatewayRunning ? tokens.data.totalGlobalTokens : undefined;

  return (
    <>
      <PageHeader
        title="Servers"
        description="Add an MCP server once and every AI app on this computer can use it."
        actions={servers.length > 0 ? <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add server</Button> : undefined}
      />
      <PageBody>
        {status.error && !status.data ? (
          <InlineAlert tone="danger" title="Couldn't load your servers" action={<Button size="sm" icon={RotateCw} onClick={() => void status.refetch()}>Try again</Button>}>
            {errorMessage(status.error)}
          </InlineAlert>
        ) : status.loading ? (
          <SkeletonList rows={4} label="Loading servers" />
        ) : servers.length === 0 ? (
          <EmptyState
            icon={Server}
            title="Add your first server"
            description="Servers give your AI apps new tools, like your issue tracker, files or database. Add one here and mcpx connects it to Claude, Cursor, VS Code and the rest."
            actions={
              <>
                <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add server</Button>
                <Button icon={ScanSearch} onClick={() => { go("clients"); request({ type: "find-existing" }); }}>Find servers your apps already use</Button>
              </>
            }
          />
        ) : (
          <div className="view-stack">
            <p className="summary-line" aria-live="polite">
              <span><strong>{plural(servers.length, "server")}</strong>{enabled.length !== servers.length ? ` · ${enabled.length} on` : ""}</span>
              {gatewayRunning && <span>{connected} connected</span>}
              {total !== undefined && total > 0 && <span>{formatTokens(total)} tokens of context in total</span>}
            </p>
            <List label="Servers">
              {sorted.map((server) => (
                <ServerRow key={server.name} server={server} onEdit={() => setEditing(server.name)} onRemove={() => setRemoving(server)} />
              ))}
            </List>
          </div>
        )}
      </PageBody>
      {dialogs}
    </>
  );
}
