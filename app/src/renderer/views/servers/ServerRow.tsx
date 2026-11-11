import { useState } from "react";
import { BellOff, Globe, LogIn, Pencil, RefreshCw, TerminalSquare, Trash2 } from "lucide-react";
import { Button, InlineAlert, ListRow, Menu, StatusLabel, Switch, Tooltip } from "../../components/ui";
import { api } from "../../lib/api";
import { isOAuthServer } from "../../lib/domain";
import { formatTokens } from "../../lib/format";
import { useNavigation } from "../../shell/navigation";
import type { ServerView } from "../../hooks/useServers";
import { useServerToggle } from "./useServerActions";

interface ServerRowProps {
  server: ServerView;
  onEdit: () => void;
  onRemove: () => void;
}

export function ServerRow({ server, onEdit, onRemove }: ServerRowProps) {
  const { openServer, request } = useNavigation();
  const toggle = useServerToggle(server.name);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const Icon = server.transport === "http" ? Globe : TerminalSquare;
  const isHttp = server.transport === "http";
  const tokens = server.enabled ? server.tokens?.total : undefined;

  return (
    <ListRow
      onOpen={() => openServer(server.name)}
      openLabel={`${server.name}, ${server.state.label}. Open details`}
      tone={server.enabled ? "default" : "muted"}
      leading={<span className="row-icon"><Icon size={15} strokeWidth={1.75} /></span>}
      title={server.name}
      subtitle={<span className="mono-subtle">{server.target}</span>}
      meta={
        <>
          {server.state.detail && server.state.kind !== "off" ? (
            <Tooltip content={server.state.detail}>
              <span tabIndex={-1}><StatusLabel tone={server.state.tone} pulse={server.state.kind === "checking"}>{server.state.label}</StatusLabel></span>
            </Tooltip>
          ) : (
            <StatusLabel tone={server.state.tone} pulse={server.state.kind === "checking"}>{server.state.label}</StatusLabel>
          )}
          <span className="cost" aria-label={tokens !== undefined ? `${formatTokens(tokens)} tokens of context` : undefined}>
            {tokens !== undefined && tokens > 0 ? `${formatTokens(tokens)} tokens` : ""}
          </span>
        </>
      }
      trailing={
        <>
          {server.state.signIn && server.enabled && (
            <Button size="sm" variant="secondary" icon={LogIn} onClick={() => request({ type: "sign-in", serverName: server.name })}>Sign in</Button>
          )}
          <Switch
            checked={server.enabled}
            busy={toggle.pending}
            label={`${server.name} enabled`}
            onCheckedChange={(enabled) => void toggle.run(enabled)}
          />
          <Menu
            label={`More actions for ${server.name}`}
            size="sm"
            items={[
              { label: "Edit", icon: Pencil, onSelect: onEdit },
              isHttp && !server.state.signIn && { label: isOAuthServer(server) ? "Sign in again" : "Sign in", icon: RefreshCw, onSelect: () => request({ type: "sign-in", serverName: server.name }) },
              server.pendingAuth && {
                label: "Hide sign-in reminder",
                icon: BellOff,
                onSelect: () => void api().auth.dismiss(server.name).catch((error: unknown) => setDismissError(String(error)))
              },
              { label: "Remove", icon: Trash2, danger: true, separated: true, onSelect: onRemove }
            ]}
          />
        </>
      }
    >
      {(toggle.error || dismissError) && (
        <InlineAlert tone="danger" onDismiss={() => { toggle.reset(); setDismissError(null); }}>
          {toggle.error ?? dismissError}
        </InlineAlert>
      )}
    </ListRow>
  );
}
