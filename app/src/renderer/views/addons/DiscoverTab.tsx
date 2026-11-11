import { useEffect, useMemo, useState } from "react";
import { Compass, RotateCw, Search } from "lucide-react";
import type { MarketplaceListing, MarketplacePluginDetail } from "@mcpx/core";
import { Badge, Button, Dialog, EmptyState, IconButton, InlineAlert, Input, List, ListRow, Select, SkeletonList, Spinner, useToast } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useMutation } from "../../lib/query";
import { refreshAddons, useListings, useMarketplaces } from "../../hooks/useAddons";
import { componentLabel } from "./plugin-helpers";

export function DiscoverTab({ onManageSources }: { onManageSources: () => void }) {
  const listings = useListings();
  const sources = useMarketplaces();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<MarketplaceListing | null>(null);

  const all = listings.data ?? [];
  const categories = useMemo(() => [...new Set(all.map((entry) => entry.category).filter((value): value is string => Boolean(value)))].sort(), [all]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((entry) => {
      if (source && entry.marketplace !== source) return false;
      if (category && entry.category !== category) return false;
      if (!needle) return true;
      return [entry.name, entry.displayName, entry.description, entry.category, ...entry.tags].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [all, query, source, category]);
  const refreshAll = useMutation(async () => {
    const results = await Promise.allSettled((sources.data ?? []).map((item) => api().marketplaces.refresh(item.name)));
    await refreshAddons();
    const errors = results.flatMap((result) => (result.status === "rejected" ? [errorMessage(result.reason)] : result.value.errors));
    if (errors.length > 0) throw new Error(errors.join("; "));
  });
  const sourceName = (name: string) => sources.data?.find((item) => item.name === name)?.displayName ?? name;

  return (
    <div className="view-stack">
      <div className="toolbar">
        <Input label="Search plugins" hideLabel type="search" placeholder="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} leading={<Search size={14} />} />
        <Select label="Source" hideLabel value={source} onChange={(event) => setSource(event.target.value)} className="ui-field--narrow">
          <option value="">All sources</option>
          {(sources.data ?? []).map((item) => <option key={item.name} value={item.name}>{item.displayName}</option>)}
        </Select>
        {categories.length > 0 && (
          <Select label="Category" hideLabel value={category} onChange={(event) => setCategory(event.target.value)} className="ui-field--narrow">
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        )}
        <IconButton icon={RotateCw} label="Check sources for new plugins" variant="secondary" loading={refreshAll.pending || listings.fetching} onClick={() => void refreshAll.run()} />
      </div>
      {refreshAll.error && <InlineAlert tone="warning" title="Some sources couldn't be refreshed" onDismiss={refreshAll.reset}>{refreshAll.error}</InlineAlert>}

      {listings.error && !listings.data ? (
        <InlineAlert tone="danger" title="Couldn't load the catalog" action={<Button size="sm" onClick={() => void listings.refetch()}>Try again</Button>}>{errorMessage(listings.error)}</InlineAlert>
      ) : listings.loading ? (
        <SkeletonList rows={5} label="Loading catalog" />
      ) : all.length === 0 ? (
        <EmptyState icon={Compass} title="Nothing to discover yet" description="Add a source to browse the plugins it offers." actions={<Button onClick={onManageSources}>Manage sources</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState size="sm" title="No matching plugins" description="Try a different search or filter." />
      ) : (
        <List label="Available plugins">
          {filtered.map((listing) => (
            <ListRow
              key={listing.id}
              onOpen={() => setSelected(listing)}
              openLabel={`${listing.displayName} details`}
              title={<>{listing.displayName}{listing.installed && <Badge tone="success">Installed</Badge>}{!listing.compatible && <Badge tone="warning">Not supported</Badge>}</>}
              subtitle={listing.description || "No description."}
              meta={<span className="cost">{sourceName(listing.marketplace)}</span>}
            />
          ))}
        </List>
      )}

      <ListingDialog listing={selected} sourceName={selected ? sourceName(selected.marketplace) : ""} onClose={() => setSelected(null)} />
    </div>
  );
}

function ListingDialog({ listing, sourceName, onClose }: { listing: MarketplaceListing | null; sourceName: string; onClose: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<MarketplacePluginDetail | null>(null);
  const inspect = useMutation(async (id: string) => {
    setDetail(await api().marketplaces.inspect(id));
  });
  const install = useMutation(async (id: string) => {
    const plugin = await api().marketplaces.install(id);
    await refreshAddons();
    toast.success(`Installed ${plugin.name}`, "It's now available in your apps.");
    onClose();
  });

  const listingId = listing?.id ?? null;
  useEffect(() => {
    setDetail(null);
    inspect.reset();
    install.reset();
    if (listingId) void inspect.run(listingId);
  }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = detail ?? listing;
  const installed = view?.installed;

  return (
    <Dialog
      open={listing !== null}
      onClose={onClose}
      title={view?.displayName ?? ""}
      description={[sourceName, view?.version ? `v${view.version}` : null, view?.author?.name].filter(Boolean).join(" · ")}
      placement="right"
      dismissible={!install.pending}
      footer={view && (
        <>
          {view.homepage && <a className="ui-button ui-button--ghost ui-button--md" href={view.homepage} target="_blank" rel="noreferrer">Homepage</a>}
          <Button
            variant="primary"
            loading={install.pending}
            disabled={installed || !view.compatible}
            onClick={() => void install.run(view.id)}
          >
            {installed ? "Installed" : view.compatible ? "Install" : "Not supported"}
          </Button>
        </>
      )}
    >
      {view && (
        <div className="view-stack">
          <p>{view.description || "No description provided."}</p>
          {install.error && <InlineAlert tone="danger" title="Couldn't install">{install.error}</InlineAlert>}
          {inspect.pending && <p className="summary-line"><Spinner /> Checking what it includes…</p>}
          {inspect.error && <InlineAlert tone="warning">Couldn't read the full details: {inspect.error}</InlineAlert>}
          <div>
            <p className="addon-detail__heading">Will install</p>
            {view.supportedCapabilities.length > 0
              ? <div className="chip-list">{view.supportedCapabilities.map((item) => <Badge key={item}>{componentLabel(item)}</Badge>)}</div>
              : <p className="text-muted">Nothing mcpx can install.</p>}
          </div>
          {view.unsupportedCapabilities.length > 0 && (
            <div>
              <p className="addon-detail__heading">Not supported by mcpx</p>
              <div className="chip-list">{view.unsupportedCapabilities.map((item) => <Badge key={item} tone="warning">{componentLabel(item)}</Badge>)}</div>
            </div>
          )}
          {view.tags.length > 0 && (
            <div>
              <p className="addon-detail__heading">Tags</p>
              <div className="chip-list">{view.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
