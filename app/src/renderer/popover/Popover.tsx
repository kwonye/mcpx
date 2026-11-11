import { useMemo } from "react";
import { AppWindow, ExternalLink, LogIn, Plus, Power, RotateCw, X } from "lucide-react";
import { Button, IconButton, InlineAlert, Menu, Skeleton, StatusDot, StatusLabel, Switch } from "../components/ui";
import { api } from "../lib/api";
import { needsAttention } from "../lib/domain";
import { errorMessage } from "../lib/errors";
import { formatTokens } from "../lib/format";
import { sortByAttention, useServers, type ServerView } from "../hooks/useServers";
import { useGatewayToggle } from "../shell/GatewayControl";
import { Wordmark } from "../shell/LogoMark";
import { useServerToggle } from "../views/servers/useServerActions";
import "./Popover.css";

/** The tray popover: status at a glance, what needs attention, quick switches. */
export function Popover() {
  const { status, servers, gatewayRunning, tokens } = useServers();
  const gateway = useGatewayToggle();
  const sorted = useMemo(() => sortByAttention(servers), [servers]);
  const attention = sorted.filter((server) => needsAttention(server.state));
  const rest = sorted.filter((server) => !needsAttention(server.state));
  const total = gatewayRunning && tokens.data?.gatewayRunning ? tokens.data.totalGlobalTokens : 0;

  const open = (route?: string) => void api().app.openDashboard(route ? { route } : undefined).catch(() => {});

  return (
    <div className="popover">
      <header className="popover__header">
        <Wordmark />
        <div className="popover__gateway">
          <StatusDot tone={!gateway.known ? "neutral" : gateway.running ? "success" : "neutral"} pulse={!gateway.known} />
          <span>{!gateway.known ? "Checking…" : gateway.running ? "Running" : "Stopped"}</span>
          {gateway.known && (
            <IconButton
              icon={Power}
              size="sm"
              label={gateway.running ? "Stop gateway" : "Start gateway"}
              loading={gateway.toggle.pending}
              onClick={() => void gateway.toggle.run()}
              tooltipSide="bottom"
            />
          )}
          <Menu
            label="More"
            size="sm"
            items={[
              { label: "Open mcpx", icon: AppWindow, onSelect: () => open() },
              { label: "Quit mcpx", icon: X, separated: true, onSelect: () => void api().app.quit() }
            ]}
          />
        </div>
      </header>

      {gateway.toggle.error && (
        <div className="popover__notice"><InlineAlert tone="danger" onDismiss={gateway.toggle.reset}>{gateway.toggle.error}</InlineAlert></div>
      )}

      <div className="popover__body">
        {status.error && !status.data ? (
          <div className="popover__notice">
            <InlineAlert tone="danger" title="Couldn't reach mcpx" action={<Button size="sm" icon={RotateCw} onClick={() => void status.refetch()}>Retry</Button>}>
              {errorMessage(status.error)}
            </InlineAlert>
          </div>
        ) : status.loading ? (
          <div className="popover__skeleton" role="status" aria-label="Loading">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} height={14} width={`${70 - index * 9}%`} />)}
          </div>
        ) : servers.length === 0 ? (
          <div className="popover__empty">
            <p className="popover__empty-title">No servers yet</p>
            <p className="popover__empty-copy">Add a server once and every AI app on this computer can use it.</p>
            <Button variant="primary" icon={Plus} onClick={() => open("servers:add")}>Add server</Button>
          </div>
        ) : (
          <>
            {attention.length > 0 && (
              <section className="popover__section" aria-labelledby="popover-attention">
                <h2 id="popover-attention" className="popover__heading">Needs attention</h2>
                <ul className="popover__list">
                  {attention.map((server) => <AttentionRow key={server.name} server={server} />)}
                </ul>
              </section>
            )}
            <section className="popover__section" aria-labelledby="popover-servers">
              <h2 id="popover-servers" className="popover__heading">
                Servers
                {total > 0 && <span className="popover__heading-meta">{formatTokens(total)} tokens</span>}
              </h2>
              <ul className="popover__list">
                {rest.map((server) => <ServerSwitchRow key={server.name} server={server} />)}
              </ul>
            </section>
          </>
        )}
      </div>

      <footer className="popover__footer">
        <Button variant="ghost" icon={Plus} onClick={() => open("servers:add")}>Add server</Button>
        <Button variant="primary" icon={ExternalLink} onClick={() => open()}>Open mcpx</Button>
      </footer>
    </div>
  );
}

function AttentionRow({ server }: { server: ServerView }) {
  return (
    <li className="popover__row">
      <div className="popover__row-text">
        <span className="popover__name">{server.name}</span>
        <StatusLabel tone={server.state.tone}>{server.state.label}</StatusLabel>
      </div>
      {server.state.signIn ? (
        <Button size="sm" variant="primary" icon={LogIn} onClick={() => void api().auth.request(server.name).catch(() => {})}>Sign in</Button>
      ) : (
        <Button size="sm" onClick={() => void api().app.openDashboard({ route: "servers" }).catch(() => {})}>Details</Button>
      )}
      {server.pendingAuth && (
        <IconButton icon={X} size="sm" label={`Dismiss sign-in reminder for ${server.name}`} onClick={() => void api().auth.dismiss(server.name).catch(() => {})} tooltipAlign="end" />
      )}
    </li>
  );
}

function ServerSwitchRow({ server }: { server: ServerView }) {
  const toggle = useServerToggle(server.name);
  return (
    <li className="popover__row">
      <div className="popover__row-text">
        <span className={server.enabled ? "popover__name" : "popover__name popover__name--off"}>{server.name}</span>
        <StatusLabel tone={server.state.tone} pulse={server.state.kind === "checking"}>{toggle.error ? "Couldn't change" : server.state.label}</StatusLabel>
      </div>
      <Switch size="sm" checked={server.enabled} busy={toggle.pending} label={`${server.name} enabled`} onCheckedChange={(enabled) => void toggle.run(enabled)} />
    </li>
  );
}
