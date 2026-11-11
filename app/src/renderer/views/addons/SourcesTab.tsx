import { useState } from "react";
import { Library, Plus, RotateCw, Trash2 } from "lucide-react";
import type { ManagedMarketplace } from "@mcpx/core";
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, InlineAlert, Input, List, ListRow, Menu, SkeletonList, StatusLabel, Switch, useToast } from "../../components/ui";
import type { Tone } from "../../components/ui/Badge";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { plural, relativeTime } from "../../lib/format";
import { useMutation } from "../../lib/query";
import { refreshAddons, useMarketplaces } from "../../hooks/useAddons";

const SOURCE_STATE: Record<ManagedMarketplace["status"], { label: string; tone: Tone }> = {
  ready: { label: "Up to date", tone: "success" },
  stale: { label: "Out of date", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  unavailable: { label: "Unavailable", tone: "neutral" }
};

export function SourcesTab() {
  const sources = useMarketplaces();
  const toast = useToast();
  const [input, setInput] = useState("");
  const [manifestPath, setManifestPath] = useState("");
  const [removing, setRemoving] = useState<ManagedMarketplace | null>(null);

  const add = useMutation(async () => {
    const source = await api().marketplaces.add(input.trim(), manifestPath.trim() || undefined);
    setInput("");
    setManifestPath("");
    await refreshAddons();
    toast.success(`Added ${source.displayName}`);
  });

  return (
    <div className="view-stack">
      <p className="text-muted">Sources are catalogs of plugins (marketplaces). Plugins from every source appear under Discover.</p>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); if (input.trim()) void add.run(); }}>
        <Input
          label="Add a source"
          hideLabel
          placeholder="Add a GitHub owner/repo, git URL, folder or marketplace.json URL"
          value={input}
          onChange={(event) => { setInput(event.target.value); add.reset(); }}
          leading={<Plus size={14} />}
          error={add.error}
        />
        <Input
          label="Catalog file"
          hideLabel
          className="ui-field--narrow"
          placeholder="Catalog path (optional)"
          value={manifestPath}
          onChange={(event) => setManifestPath(event.target.value)}
          mono
        />
        <Button type="submit" loading={add.pending} disabled={!input.trim()}>Add source</Button>
      </form>

      {sources.error && !sources.data ? (
        <InlineAlert tone="danger" title="Couldn't load sources">{errorMessage(sources.error)}</InlineAlert>
      ) : sources.loading ? (
        <SkeletonList rows={2} label="Loading sources" />
      ) : (sources.data ?? []).length === 0 ? (
        <EmptyState icon={Library} title="No sources" description="Add one above to discover plugins." />
      ) : (
        <List label="Sources">
          {(sources.data ?? []).map((source) => <SourceRow key={source.name} source={source} onRemove={() => setRemoving(source)} />)}
        </List>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.displayName ?? "source"}?`}
        message="Plugins installed from it are uninstalled too."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await api().marketplaces.remove(removing.name);
          toast.success(`Removed ${removing.displayName}`);
          setRemoving(null);
          await refreshAddons();
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function SourceRow({ source, onRemove }: { source: ManagedMarketplace; onRemove: () => void }) {
  const toast = useToast();
  const state = SOURCE_STATE[source.status] ?? { label: source.status, tone: "neutral" as Tone };
  const checked = relativeTime(source.lastCheckedAt);

  const refresh = useMutation(async () => {
    const result = await api().marketplaces.refresh(source.name);
    await refreshAddons();
    if (result.errors.length > 0) throw new Error(result.errors.join("; "));
    toast.success(`Refreshed ${source.displayName}`, result.updated.length > 0 ? `Updated ${plural(result.updated.length, "plugin")}.` : "Everything is up to date.");
  });
  const autoUpdate = useMutation(async (enabled: boolean) => {
    await api().marketplaces.setAutoUpdate(source.name, enabled);
    await refreshAddons();
  });

  return (
    <ListRow
      leading={<span className="row-icon"><Library size={15} strokeWidth={1.75} /></span>}
      title={<>{source.displayName}{source.builtIn && <Badge>Built-in</Badge>}</>}
      subtitle={`${source.source}${checked ? ` · checked ${checked}` : ""}`}
      meta={<StatusLabel tone={state.tone}>{state.label}</StatusLabel>}
      trailing={
        <>
          <label className="inline-switch">
            <span>Auto-update</span>
            <Switch checked={source.autoUpdate} busy={autoUpdate.pending} size="sm" label={`Auto-update ${source.displayName}`} onCheckedChange={(enabled) => void autoUpdate.run(enabled)} />
          </label>
          <IconButton icon={RotateCw} size="sm" label={`Refresh ${source.displayName}`} loading={refresh.pending} onClick={() => void refresh.run()} />
          {!source.builtIn && (
            <Menu label={`More actions for ${source.displayName}`} size="sm" items={[{ label: "Remove", icon: Trash2, danger: true, onSelect: onRemove }]} />
          )}
        </>
      }
    >
      {(refresh.error || autoUpdate.error) && <InlineAlert tone="danger" onDismiss={() => { refresh.reset(); autoUpdate.reset(); }}>{refresh.error ?? autoUpdate.error}</InlineAlert>}
      {!refresh.error && source.error && <p className="row-note row-note--danger">{source.error}</p>}
    </ListRow>
  );
}
