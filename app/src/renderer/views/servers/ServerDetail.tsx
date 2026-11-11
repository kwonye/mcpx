import { LogIn, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, InlineAlert, Section, StatusLabel, Switch } from "../../components/ui";
import { isOAuthServer, syncedClients, transportLabel } from "../../lib/domain";
import { formatTokens, plural } from "../../lib/format";
import { PageBody, PageHeader } from "../../shell/PageHeader";
import { useNavigation } from "../../shell/navigation";
import type { ServerView } from "../../hooks/useServers";
import { useServerToggle } from "./useServerActions";

interface ServerDetailProps {
  server: ServerView | undefined;
  loading: boolean;
  onEdit: (server: ServerView) => void;
  onRemove: (server: ServerView) => void;
}

export function ServerDetail({ server, loading, onEdit, onRemove }: ServerDetailProps) {
  const { openServer, request } = useNavigation();
  const toggle = useServerToggle(server?.name ?? "");

  if (!server) {
    return (
      <>
        <PageHeader title="Server" onBack={() => openServer(null)} backLabel="Back to servers" />
        <PageBody>
          {!loading && <EmptyState title="This server no longer exists" description="It may have been removed from another window or the command line." actions={<Button onClick={() => openServer(null)}>Back to servers</Button>} />}
        </PageBody>
      </>
    );
  }

  const isHttp = server.transport === "http";
  const spec = server.spec;
  const bindings = server.authBindings;
  const apps = syncedClients(server);
  const oauth = isOAuthServer(server);
  const tokenSecret = bindings.find((binding) => binding.kind === "header" && binding.value.startsWith("secret://") && binding.key.toLowerCase() === "authorization");
  const signInSummary = oauth ? "Signed in with your browser." : tokenSecret ? `Uses a saved token (${tokenSecret.key} header).` : "No sign-in saved.";

  return (
    <>
      <PageHeader
        onBack={() => openServer(null)}
        backLabel="Back to servers"
        title={server.name}
        titleAccessory={<StatusLabel tone={server.state.tone}>{server.state.label}</StatusLabel>}
        actions={
          <>
            <Switch checked={server.enabled} busy={toggle.pending} label={`${server.name} enabled`} onCheckedChange={(enabled) => void toggle.run(enabled)} />
            <Button icon={Pencil} onClick={() => onEdit(server)}>Edit</Button>
          </>
        }
      />
      <PageBody>
        <div className="view-stack">
          {toggle.error && <InlineAlert tone="danger" onDismiss={toggle.reset}>{toggle.error}</InlineAlert>}
          {server.enabled && server.state.detail && (server.state.kind === "needs-sign-in" || server.state.kind === "error" || server.state.kind === "gateway-stopped") && (
            <InlineAlert
              tone={server.state.kind === "error" ? "danger" : server.state.kind === "needs-sign-in" ? "warning" : "info"}
              title={server.state.label}
              action={server.state.signIn ? <Button size="sm" variant="primary" icon={LogIn} onClick={() => request({ type: "sign-in", serverName: server.name })}>Sign in</Button> : undefined}
            >
              {server.state.detail}
            </InlineAlert>
          )}

          <Section title="Connection">
            <dl className="detail-grid">
              <dt>Type</dt>
              <dd>{transportLabel(server.transport)}</dd>
              {spec?.transport === "http" ? (
                <>
                  <dt>URL</dt>
                  <dd className="mono">{spec.url}</dd>
                </>
              ) : (
                <>
                  <dt>Command</dt>
                  <dd className="mono">{spec?.transport === "stdio" ? [spec.command, ...(spec.args ?? [])].join(" ") : server.target}</dd>
                  {spec?.transport === "stdio" && spec.cwd && (
                    <>
                      <dt>Working folder</dt>
                      <dd className="mono">{spec.cwd}</dd>
                    </>
                  )}
                </>
              )}
              <dt>Context cost</dt>
              <dd>
                {server.tokens && server.tokens.total > 0
                  ? `${formatTokens(server.tokens.total)} tokens · ${plural(server.tokens.tools, "tool")}, ${plural(server.tokens.resources, "resource")}, ${plural(server.tokens.prompts, "prompt")}`
                  : <span className="text-muted">{server.enabled ? "Shown once the gateway has connected." : "Not counted while off."}</span>}
              </dd>
            </dl>
          </Section>

          {isHttp && (
            <Section
              title="Sign-in"
              actions={<Button size="sm" icon={LogIn} onClick={() => request({ type: "sign-in", serverName: server.name })}>{oauth || tokenSecret ? "Sign in again" : "Sign in"}</Button>}
            >
              <p className="section-text">{signInSummary}</p>
            </Section>
          )}

          <Section
            title={isHttp ? "Headers" : "Environment variables"}
            description="Secret values are stored encrypted and never shown."
            actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(server)}>Edit</Button>}
          >
            {bindings.length === 0 ? (
              <p className="section-text text-muted">{isHttp ? "No custom headers." : "No environment variables."}</p>
            ) : (
              <dl className="detail-grid">
                {bindings.map((binding) => (
                  <BindingRow key={`${binding.kind}:${binding.key}`} name={binding.key} value={binding.value} />
                ))}
              </dl>
            )}
          </Section>

          <Section title="Used by" description="Apps that mcpx has connected to this server.">
            <div className="section-text">
              {apps.length > 0 ? (
                <div className="chip-list">{apps.map((app) => <Badge key={app}>{app}</Badge>)}</div>
              ) : (
                <span className="text-muted">{server.enabled ? "No apps yet. Sync from Clients to connect your apps." : "Turn the server on to make it available to your apps."}</span>
              )}
            </div>
          </Section>

          <Section title="Remove server">
            <div className="danger-zone">
              <p>Removes {server.name} from mcpx and from every app it was synced to.</p>
              <Button icon={Trash2} onClick={() => onRemove(server)}>Remove…</Button>
            </div>
          </Section>
        </div>
      </PageBody>
    </>
  );
}

function BindingRow({ name, value }: { name: string; value: string }) {
  const kind = value.startsWith("oauth://") ? "sign-in" : value.startsWith("secret://") ? "secret" : "plain";
  return (
    <>
      <dt className="mono">{name}</dt>
      <dd>
        {kind === "plain" ? <span className="mono">{value}</span> : kind === "secret" ? <Badge>Secret</Badge> : <Badge tone="accent">Browser sign-in</Badge>}
      </dd>
    </>
  );
}
