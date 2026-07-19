import { useEffect, useMemo, useState } from "react";
import { SkillsTab } from "./SkillsTab";
import { Toggle } from "./ui/Toggle";
import type {
  ManagedMarketplace,
  ManagedPlugin,
  MarketplaceListing,
  MarketplacePluginDetail,
  PluginComponent,
} from "@mcpx/core";

type View = "discover" | "installed" | "marketplaces" | "skills";

export function PluginsTab() {
  const [view, setView] = useState<View>("discover");
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<ManagedMarketplace[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [detail, setDetail] = useState<MarketplacePluginDetail | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installInput, setInstallInput] = useState("");
  const [installingSource, setInstallingSource] = useState(false);
  const [marketplaceInput, setMarketplaceInput] = useState("");
  const [addingMarketplace, setAddingMarketplace] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  async function loadPlugins() {
    try {
      setPlugins(await window.mcpx.plugins.list() as ManagedPlugin[]);
    } catch (caught) {
      setPlugins([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function loadMarketplaces() {
    try {
      setMarketplaces(await window.mcpx.plugins.marketplaces.list() as ManagedMarketplace[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function loadCatalog() {
    setLoadingCatalog(true);
    setError(null);
    try {
      const [available] = await Promise.all([
        window.mcpx.plugins.marketplaces.browse(),
        loadMarketplaces(),
        loadPlugins(),
      ]);
      setListings(available as MarketplaceListing[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    if (view === "discover") void loadCatalog();
    if (view === "installed") void loadPlugins();
    if (view === "marketplaces") void loadMarketplaces();
  }, [view]);

  const categories = useMemo(() => [...new Set(listings.map((entry) => entry.category).filter((value): value is string => Boolean(value)))].sort(), [listings]);
  const filteredListings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listings.filter((entry) => {
      if (marketplaceFilter && entry.marketplace !== marketplaceFilter) return false;
      if (categoryFilter && entry.category !== categoryFilter) return false;
      if (!needle) return true;
      return [entry.name, entry.displayName, entry.description, entry.category, ...entry.tags]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [listings, query, marketplaceFilter, categoryFilter]);

  async function openDetail(listing: MarketplaceListing) {
    setInspecting(true);
    setError(null);
    try {
      setDetail(await window.mcpx.plugins.marketplaces.inspectPlugin(listing.id) as MarketplacePluginDetail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInspecting(false);
    }
  }

  async function installListing(selected: MarketplacePluginDetail) {
    if (!selected.compatible || !confirm(`Install "${selected.displayName}" with ${selected.supportedCapabilities.join(", ")}?`)) return;
    setInstallingId(selected.id);
    setError(null);
    try {
      await window.mcpx.plugins.marketplaces.installPlugin(selected.id);
      setDetail(null);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstallingId(null);
    }
  }

  async function installSource(event: React.FormEvent) {
    event.preventDefault();
    if (!installInput.trim()) return;
    setInstallingSource(true);
    setError(null);
    try {
      await window.mcpx.plugins.install(installInput.trim());
      setInstallInput("");
      await loadPlugins();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setInstallingSource(false);
    }
  }

  async function togglePlugin(plugin: ManagedPlugin) {
    setError(null);
    try {
      await (plugin.enabled ? window.mcpx.plugins.disable(plugin.id) : window.mcpx.plugins.enable(plugin.id));
      await loadPlugins();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function approve(pluginId: string, component: string) {
    try {
      await window.mcpx.plugins.approve(pluginId, component);
      await loadPlugins();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function uninstall(plugin: ManagedPlugin) {
    if (!confirm(`Uninstall plugin "${plugin.name}"? Plugin data will be kept.`)) return;
    try {
      await window.mcpx.plugins.uninstall(plugin.id, true);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function update(plugin: ManagedPlugin) {
    try {
      await window.mcpx.plugins.update(plugin.id);
      await loadPlugins();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function addMarketplace(event: React.FormEvent) {
    event.preventDefault();
    if (!marketplaceInput.trim()) return;
    setAddingMarketplace(true);
    try {
      await window.mcpx.plugins.marketplaces.add(marketplaceInput.trim());
      setMarketplaceInput("");
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAddingMarketplace(false);
    }
  }

  async function refreshMarketplace(name: string) {
    try {
      await window.mcpx.plugins.marketplaces.refresh(name);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await loadMarketplaces();
    }
  }

  async function removeMarketplace(marketplace: ManagedMarketplace) {
    if (!confirm(`Remove "${marketplace.displayName}" and uninstall plugins installed from it?`)) return;
    try {
      await window.mcpx.plugins.marketplaces.remove(marketplace.name);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function toggleMarketplaceUpdates(marketplace: ManagedMarketplace) {
    try {
      await window.mcpx.plugins.marketplaces.setAutoUpdate(marketplace.name, !marketplace.autoUpdate);
      await loadMarketplaces();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const gatedComponents = ["hooks", "commands", "mcpServers"] as const;

  return (
    <div className="plugins-tab">
      <div className="page-header page-header--split">
        <h1 className="page-title">Plugins</h1>
      </div>

      <div className="plugin-view-tabs" role="tablist" aria-label="Plugin views">
        {(["discover", "installed", "marketplaces", "skills"] as View[]).map((item) => (
          <button key={item} role="tab" aria-selected={view === item} className="plugin-view-tab" data-active={view === item} onClick={() => setView(item)}>
            {item === "skills" ? "Shared Skills" : item[0].toUpperCase() + item.slice(1)}
            {item === "installed" && plugins.length > 0 ? ` (${plugins.length})` : ""}
          </button>
        ))}
      </div>

      {error && <div className="feedback-message error">{error}</div>}

      {view === "discover" && (
        <section className="plugin-marketplace-view">
          <div className="plugin-browser-controls">
            <input className="glass-input" type="search" placeholder="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="glass-input" aria-label="Marketplace" value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)}>
              <option value="">All marketplaces</option>
              {marketplaces.map((marketplace) => <option key={marketplace.name} value={marketplace.name}>{marketplace.displayName}</option>)}
            </select>
            <select className="glass-input" aria-label="Category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={() => void loadCatalog()} disabled={loadingCatalog}>Refresh</button>
          </div>
          {loadingCatalog ? <div className="loading-state">Refreshing marketplaces…</div> : (
            <div className="plugin-discovery-grid">
              {filteredListings.map((listing) => (
                <button key={listing.id} className="plugin-discovery-card" onClick={() => void openDetail(listing)}>
                  <div className="plugin-discovery-card__heading">
                    <strong>{listing.displayName}</strong>
                    {listing.installed && <span className="plugin-badge plugin-badge--success">Installed</span>}
                  </div>
                  <p>{listing.description || "Inspect this plugin to see its capabilities."}</p>
                  <div className="plugin-discovery-card__meta">
                    <span>{marketplaces.find((item) => item.name === listing.marketplace)?.displayName ?? listing.marketplace}</span>
                    {listing.category && <span>{listing.category}</span>}
                    <span className={`plugin-badge ${listing.compatible ? "plugin-badge--success" : "plugin-badge--warning"}`}>
                      {listing.compatible ? "Compatible" : "Unsupported"}
                    </span>
                  </div>
                </button>
              ))}
              {filteredListings.length === 0 && <div className="empty-state"><p>No matching plugins.</p></div>}
            </div>
          )}
          {inspecting && <div className="plugin-detail-overlay"><div className="plugin-detail-panel">Inspecting plugin…</div></div>}
          {detail && (
            <div className="plugin-detail-overlay" role="dialog" aria-modal="true" aria-label={`${detail.displayName} details`}>
              <div className="plugin-detail-panel">
                <div className="plugin-detail-panel__header">
                  <div><h2>{detail.displayName}</h2><span>{detail.id}</span></div>
                  <button className="btn btn-sm btn-secondary" onClick={() => setDetail(null)}>Close</button>
                </div>
                <p>{detail.description || "No description provided."}</p>
                <div className="plugin-detail-section"><strong>Will install</strong><div className="plugin-chip-row">{detail.supportedCapabilities.map((capability) => <span className="plugin-component-chip" key={capability}>{capability}</span>)}</div></div>
                {detail.unsupportedCapabilities.length > 0 && <div className="plugin-detail-section"><strong>Not supported by mcpx</strong><div className="plugin-chip-row">{detail.unsupportedCapabilities.map((capability) => <span className="plugin-component-chip plugin-component-chip--muted" key={capability}>{capability}</span>)}</div></div>}
                <div className="plugin-detail-panel__footer">
                  {detail.homepage && <a className="btn btn-secondary" href={detail.homepage} target="_blank" rel="noreferrer">Homepage</a>}
                  <button className="btn btn-primary" disabled={!detail.compatible || detail.installed || installingId === detail.id} onClick={() => void installListing(detail)}>
                    {detail.installed ? "Installed" : installingId === detail.id ? "Installing…" : detail.compatible ? "Install" : "Unavailable"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {view === "installed" && (
        <section>
          <form onSubmit={installSource} className="plugin-install-row">
            <input type="text" className="glass-input plugin-install-input" placeholder="GitHub owner/repo, git URL, or local path" value={installInput} onChange={(event) => setInstallInput(event.target.value)} disabled={installingSource} />
            <button type="submit" className="btn btn-primary" disabled={installingSource || !installInput.trim()}>{installingSource ? "Installing…" : "Install from source"}</button>
          </form>
          {plugins.length === 0 && <div className="empty-state"><p>No plugins installed.</p></div>}
          <div className="plugin-list">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="plugin-card">
                <div className="plugin-card__header"><div className="plugin-card__title-row"><span className="plugin-card__name">{plugin.name}</span><span className="plugin-card__version">v{plugin.version}</span><span className={`plugin-card__status ${plugin.status === "error" ? "plugin-card__status--error" : ""}`}>{plugin.status}</span></div><div className="plugin-card__source">{plugin.marketplace ? `${plugin.marketplace.pluginName}@${plugin.marketplace.name}` : plugin.source}</div></div>
                <div className="plugin-card__controls"><Toggle id={`plugin-enabled-${plugin.id}`} checked={plugin.enabled} onChange={() => void togglePlugin(plugin)} label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`} /><button type="button" className="btn btn-sm btn-secondary" onClick={() => toggleExpanded(plugin.id)}>{expanded.has(plugin.id) ? "Less" : "More"}</button></div>
                {expanded.has(plugin.id) && <div className="plugin-card__detail">
                  <div className="plugin-card__components">{Object.entries(plugin.components).filter(([, enabled]) => enabled).map(([key]) => { const needsApproval = gatedComponents.includes(key as typeof gatedComponents[number]) && plugin.approvals?.[key as PluginComponent] !== true; return <span key={key} className="plugin-component-chip">{key}{needsApproval && <button type="button" className="plugin-approve-btn" onClick={() => void approve(plugin.id, key)}>Approve</button>}</span>; })}</div>
                  {plugin.updateError && <div className="feedback-message error">Update failed: {plugin.updateError}</div>}
                  <div className="plugin-card__footer"><button type="button" className="btn btn-sm btn-secondary" onClick={() => void update(plugin)}>Update</button><button type="button" className="btn btn-sm btn-danger" onClick={() => void uninstall(plugin)}>Uninstall</button></div>
                </div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {view === "marketplaces" && (
        <section className="marketplaces-view">
          <form className="plugin-install-row" onSubmit={addMarketplace}>
            <input className="glass-input plugin-install-input" placeholder="GitHub owner/repo, git URL, local path, or marketplace.json URL" value={marketplaceInput} onChange={(event) => setMarketplaceInput(event.target.value)} />
            <button className="btn btn-primary" disabled={addingMarketplace || !marketplaceInput.trim()}>{addingMarketplace ? "Adding…" : "Add marketplace"}</button>
          </form>
          <div className="marketplace-list">
            {marketplaces.map((marketplace) => (
              <div className="marketplace-card" key={marketplace.name}>
                <div><div className="marketplace-card__heading"><strong>{marketplace.displayName}</strong>{marketplace.builtIn && <span className="plugin-badge">Default</span>}<span className={`plugin-badge ${marketplace.status === "ready" ? "plugin-badge--success" : "plugin-badge--warning"}`}>{marketplace.status}</span></div><p>{marketplace.name} · {marketplace.source}</p>{marketplace.error && <span className="marketplace-card__error">{marketplace.error}</span>}</div>
                <div className="marketplace-card__actions"><div className="marketplace-auto-update"><Toggle id={`marketplace-auto-update-${marketplace.name}`} checked={marketplace.autoUpdate} onChange={() => void toggleMarketplaceUpdates(marketplace)} label={`Auto-update ${marketplace.displayName}`} /><span>Auto-update</span></div><button className="btn btn-sm btn-secondary" onClick={() => void refreshMarketplace(marketplace.name)}>Refresh</button>{!marketplace.builtIn && <button className="btn btn-sm btn-danger" onClick={() => void removeMarketplace(marketplace)}>Remove</button>}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === "skills" && <SkillsTab />}
    </div>
  );
}
