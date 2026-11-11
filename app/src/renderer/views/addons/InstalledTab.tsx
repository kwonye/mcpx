import { useState } from "react";
import { ArrowUpCircle, Download, History, Info, Pin, PinOff, Puzzle, Trash2 } from "lucide-react";
import type { ManagedPlugin } from "@mcpx/core";
import { Badge, Button, ConfirmDialog, EmptyState, InlineAlert, Input, List, ListRow, Menu, SkeletonList, StatusLabel, Switch, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useMutation } from "../../lib/query";
import { refreshAddons, usePlugins } from "../../hooks/useAddons";
import { needsApproval, pluginSource, pluginState } from "./plugin-helpers";
import { PluginDetailDialog } from "./PluginDetailDialog";

export function InstalledTab({ onDiscover }: { onDiscover: () => void }) {
  const plugins = usePlugins();
  const toast = useToast();
  const [source, setSource] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<ManagedPlugin | null>(null);

  const install = useMutation(async () => {
    const plugin = await api().plugins.install(source.trim());
    setSource("");
    await refreshAddons();
    toast.success(`Installed ${plugin.name}`);
  });

  const list = plugins.data ?? [];
  const detail = list.find((plugin) => plugin.id === detailId) ?? null;

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!source.trim()) return;
          void install.run();
        }}
      >
        <Input
          label="Install from a source"
          hideLabel
          placeholder="Install from GitHub owner/repo, a git URL or a local folder"
          value={source}
          onChange={(event) => { setSource(event.target.value); install.reset(); }}
          mono
          leading={<Download size={14} />}
          error={install.error}
        />
        <Button type="submit" loading={install.pending} disabled={!source.trim()}>Install</Button>
      </form>

      {plugins.error && !plugins.data ? (
        <InlineAlert tone="danger" title="Couldn't load plugins">{errorMessage(plugins.error)}</InlineAlert>
      ) : plugins.loading ? (
        <SkeletonList rows={3} label="Loading plugins" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No plugins installed"
          description="Plugins bundle servers, skills, commands and agents into one install."
          actions={<Button variant="primary" onClick={onDiscover}>Browse plugins</Button>}
        />
      ) : (
        <List label="Installed plugins">
          {list.map((plugin) => (
            <PluginRow key={plugin.id} plugin={plugin} onOpen={() => setDetailId(plugin.id)} onUninstall={() => setUninstalling(plugin)} />
          ))}
        </List>
      )}

      <PluginDetailDialog plugin={detail} onClose={() => setDetailId(null)} />
      <ConfirmDialog
        open={uninstalling !== null}
        title={`Uninstall ${uninstalling?.name ?? "plugin"}?`}
        message="It's removed from all your apps. Its saved data is kept in case you reinstall."
        confirmLabel="Uninstall"
        destructive
        onConfirm={async () => {
          if (!uninstalling) return;
          await api().plugins.uninstall(uninstalling.id, true);
          toast.success(`Uninstalled ${uninstalling.name}`);
          setUninstalling(null);
          await refreshAddons();
        }}
        onCancel={() => setUninstalling(null)}
      />
    </div>
  );
}

function PluginRow({ plugin, onOpen, onUninstall }: { plugin: ManagedPlugin; onOpen: () => void; onUninstall: () => void }) {
  const toast = useToast();
  const state = pluginState(plugin);
  const approval = needsApproval(plugin).length > 0;

  const action = useMutation(async (kind: "toggle" | "update" | "pin" | "unpin" | "rollback") => {
    if (kind === "toggle") await (plugin.enabled ? api().plugins.disable(plugin.id) : api().plugins.enable(plugin.id));
    if (kind === "update") {
      const next = await api().plugins.update(plugin.id);
      toast.success(next.version === plugin.version ? `${plugin.name} is up to date` : `Updated ${plugin.name} to v${next.version}`);
    }
    if (kind === "pin") { await api().plugins.pin(plugin.id); toast.success(`Pinned ${plugin.name} to v${plugin.version}`); }
    if (kind === "unpin") { await api().plugins.unpin(plugin.id); toast.success(`${plugin.name} will update again`); }
    if (kind === "rollback") {
      const next = await api().plugins.rollback(plugin.id);
      toast.success(`Rolled ${plugin.name} back to v${next.version}`);
    }
    await refreshAddons();
  });

  return (
    <ListRow
      onOpen={onOpen}
      openLabel={`${plugin.name} details`}
      tone={plugin.enabled ? "default" : "muted"}
      leading={<span className="row-icon"><Puzzle size={15} strokeWidth={1.75} /></span>}
      title={<>{plugin.name}<Badge>v{plugin.version}</Badge>{plugin.pinned && <Badge>Pinned</Badge>}</>}
      subtitle={<span className="mono-subtle">{pluginSource(plugin)}</span>}
      meta={approval ? <StatusLabel tone="warning">Needs approval</StatusLabel> : <StatusLabel tone={state.tone}>{state.label}</StatusLabel>}
      trailing={
        <>
          <Switch checked={plugin.enabled} busy={action.pending} label={`${plugin.name} enabled`} onCheckedChange={() => void action.run("toggle")} />
          <Menu
            label={`More actions for ${plugin.name}`}
            size="sm"
            items={[
              { label: approval ? "Review & approve…" : "Details", icon: Info, onSelect: onOpen },
              { label: "Check for update", icon: ArrowUpCircle, onSelect: () => void action.run("update"), disabled: plugin.pinned },
              plugin.pinned
                ? { label: "Unpin version", icon: PinOff, onSelect: () => void action.run("unpin") }
                : { label: "Pin this version", icon: Pin, onSelect: () => void action.run("pin") },
              plugin.previous && { label: `Roll back to v${plugin.previous.version}`, icon: History, onSelect: () => void action.run("rollback") },
              { label: "Uninstall", icon: Trash2, danger: true, separated: true, onSelect: onUninstall }
            ]}
          />
        </>
      }
    >
      {action.error && <InlineAlert tone="danger" onDismiss={action.reset}>{action.error}</InlineAlert>}
      {!action.error && plugin.updateError && <InlineAlert tone="warning" title="Last update failed">{plugin.updateError}</InlineAlert>}
    </ListRow>
  );
}
