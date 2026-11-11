import { ShieldCheck } from "lucide-react";
import type { ManagedPlugin, PluginComponent } from "@mcpx/core";
import { Badge, Button, Dialog, InlineAlert, StatusLabel, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { clientName } from "../../lib/domain";
import { relativeTime } from "../../lib/format";
import { useMutation } from "../../lib/query";
import { refreshAddons } from "../../hooks/useAddons";
import { componentLabel, needsApproval, pluginSource, pluginState } from "./plugin-helpers";

const APPROVAL_COPY: Partial<Record<PluginComponent, string>> = {
  hooks: "Hooks run scripts automatically when your apps do certain things.",
  commands: "Commands add actions your apps can run.",
  mcpServers: "Servers start programs on this computer."
};

export function PluginDetailDialog({ plugin, onClose }: { plugin: ManagedPlugin | null; onClose: () => void }) {
  const toast = useToast();
  const approve = useMutation(async (component: PluginComponent) => {
    if (!plugin) return;
    await api().plugins.approve(plugin.id, component);
    await refreshAddons();
    toast.success(`Approved ${componentLabel(component).toLowerCase()} for ${plugin.name}`);
  });

  if (!plugin) return <Dialog open={false} onClose={onClose} title="" />;

  const pending = needsApproval(plugin);
  const state = pluginState(plugin);
  const counts = (Object.keys(plugin.components) as PluginComponent[])
    .filter((key) => plugin.components[key])
    .map((key) => ({ key, count: key === "mcpServers" ? plugin.discovered.mcpServers.length : plugin.discovered[key]?.length ?? 0 }));

  return (
    <Dialog open onClose={onClose} title={plugin.name} description={pluginSource(plugin)} placement="right">
      <div className="view-stack">
        <div className="summary-line">
          <StatusLabel tone={state.tone}>{state.label}</StatusLabel>
          <span>v{plugin.version}{plugin.pinned ? " · pinned" : ""}</span>
          {relativeTime(plugin.installedAt) && <span>Installed {relativeTime(plugin.installedAt)}</span>}
        </div>
        {plugin.error && <InlineAlert tone="danger" title="Problem">{plugin.error}</InlineAlert>}
        {plugin.updateError && <InlineAlert tone="warning" title="Last update failed">{plugin.updateError}</InlineAlert>}

        {pending.length > 0 && (
          <div className="addon-approvals">
            <p className="addon-detail__heading">Needs your approval</p>
            {pending.map((component) => (
              <div key={component} className="addon-approval">
                <div>
                  <p className="addon-approval__title">{componentLabel(component)}</p>
                  <p className="text-muted addon-approval__copy">{APPROVAL_COPY[component]}</p>
                </div>
                <Button size="sm" variant="primary" icon={ShieldCheck} loading={approve.pending} onClick={() => void approve.run(component)}>Approve</Button>
              </div>
            ))}
            {approve.error && <InlineAlert tone="danger" onDismiss={approve.reset}>{approve.error}</InlineAlert>}
          </div>
        )}

        <div>
          <p className="addon-detail__heading">Includes</p>
          {counts.length === 0 ? <p className="text-muted">Nothing enabled.</p> : (
            <div className="chip-list">
              {counts.map(({ key, count }) => <Badge key={key}>{componentLabel(key)}{count > 0 ? ` · ${count}` : ""}</Badge>)}
            </div>
          )}
        </div>

        {plugin.discovered.mcpServers.length > 0 && (
          <div>
            <p className="addon-detail__heading">Servers</p>
            <ul className="addon-detail__list">
              {plugin.discovered.mcpServers.map((server) => <li key={server.id} className="mono">{server.id}</li>)}
            </ul>
          </div>
        )}
        {plugin.discovered.skills.length > 0 && (
          <div>
            <p className="addon-detail__heading">Skills</p>
            <ul className="addon-detail__list">
              {plugin.discovered.skills.map((skill) => <li key={skill.id}><span className="mono">{skill.id}</span>{skill.description && <span className="text-muted"> — {skill.description}</span>}</li>)}
            </ul>
          </div>
        )}

        <div>
          <p className="addon-detail__heading">Available in</p>
          {plugin.projectedClients.length > 0 ? (
            <div className="chip-list">{plugin.projectedClients.map((id) => <Badge key={id}>{clientName(id)}</Badge>)}</div>
          ) : <p className="text-muted">Not synced to any app yet.</p>}
        </div>
      </div>
    </Dialog>
  );
}
