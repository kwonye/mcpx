import { useState, useEffect, useRef, useMemo } from "react";
import { useRegistryList } from "../hooks/useMcpx";
import { AddServerForm } from "./AddServerForm";

interface BrowseTabProps {
  onServerAdded: () => void;
  status: {
    servers: Array<{ name: string }>;
  };
  initialState?: {
    searchQuery?: string;
    activeCategory?: string;
  };
  onStateChange?: (state: { searchQuery?: string; activeCategory?: string }) => void;
}

interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
}

interface RegistryIcon {
  src: string;
  mimeType?: string;
}

function fourteenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
}

const CATEGORIES = [
  { id: "all", label: "All Servers", query: "", updatedSince: undefined as string | undefined },
  { id: "recent", label: "Recently Updated", query: "", updatedSince: fourteenDaysAgo() },
];

function getTransportLabel(entry: {
  server: {
    packages?: Array<{ transport: { type: string } }>;
    remotes?: Array<{ type: string }>;
  };
}): string | null {
  if (entry.server.packages?.some(p => p.transport.type === "stdio")) return "stdio";
  if (entry.server.remotes?.some(r => r.type === "streamable-http")) return "HTTP";
  if (entry.server.remotes?.some(r => r.type === "sse")) return "SSE";
  return null;
}

function getStatus(entry: {
  _meta?: Record<string, unknown>;
}): string | null {
  const meta = entry._meta as Record<string, any> | undefined;
  const official = meta?.["io.modelcontextprotocol.registry/official"] as Record<string, any> | undefined;
  if (!official) return null;
  const status: string = official.status;
  if (status === "active") return null;
  return status;
}

function getIcon(entry: {
  server: { icons?: RegistryIcon[] };
}): RegistryIcon | null {
  const icons = entry.server.icons;
  if (!icons || icons.length === 0) return null;
  return icons[0];
}

function getRepoUrl(entry: {
  server: { repository?: { url?: string } };
}): string | null {
  return entry.server.repository?.url ?? null;
}

function getWebsiteUrl(entry: {
  server: { websiteUrl?: string };
}): string | null {
  return entry.server.websiteUrl ?? null;
}

export function BrowseTab({ onServerAdded, status, initialState, onStateChange }: BrowseTabProps) {
  const { servers, loading, search, debouncedSearch, loadMore, hasMore } = useRegistryList();
  const [searchInput, setSearchInput] = useState(initialState?.searchQuery ?? "");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(initialState?.activeCategory ?? "all");
  const [activeUpdatedSince, setActiveUpdatedSince] = useState<string | undefined>();
  const [adding, setAdding] = useState<{
    registryName: string;
    shortName: string;
    requiredInputs: RequiredInput[];
  } | null>(null);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "name" | "name-desc" | "updated">("default");
  const initialSearchTriggered = useRef(false);

  const installedServerNames = new Set(status.servers.map(s => s.name));

  useEffect(() => {
    if (initialSearchTriggered.current) return;
    initialSearchTriggered.current = true;

    if (initialState?.searchQuery) {
      const query = initialState.searchQuery.trim();
      setActiveQuery(query);
      search(query);
    } else if (initialState?.activeCategory && initialState.activeCategory !== "all") {
      const category = CATEGORIES.find(c => c.id === initialState.activeCategory);
      if (category) {
        setActiveQuery(category.query);
        setActiveUpdatedSince(category.updatedSince);
        search(category.query, category.updatedSince);
      }
    }
  }, [initialState, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedQuery = searchInput.trim();
    setActiveCategory("");
    setActiveUpdatedSince(undefined);
    setActiveQuery(normalizedQuery);
    search(normalizedQuery);
    onStateChange?.({ searchQuery: normalizedQuery, activeCategory: "" });
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    setActiveCategory("");
    setActiveUpdatedSince(undefined);
    debouncedSearch(value);
  };

  const handleCategoryClick = (categoryId: string, categoryQuery: string, updatedSince?: string) => {
    setActiveCategory(categoryId);
    setSearchInput("");
    setActiveQuery(categoryQuery);
    setActiveUpdatedSince(updatedSince);
    search(categoryQuery, updatedSince);
    onStateChange?.({ searchQuery: "", activeCategory: categoryId });
  };

  const handleAdd = async (registryName: string) => {
    try {
      setIsError(false);
      setAddStatus("Preparing...");
      const result = await window.mcpx.registryPrepareAdd(registryName);
      if (result.requiredInputs.length === 0) {
        const addResult = await window.mcpx.registryConfirmAdd({});
        setAddStatus(`Added "${addResult.added}" successfully!`);
        onServerAdded();
      } else {
        setAdding({
          registryName,
          shortName: result.shortName,
          requiredInputs: result.requiredInputs
        });
        setAddStatus(null);
      }
    } catch (err) {
      setIsError(true);
      setAddStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRemove = async (serverName: string) => {
    try {
      setIsError(false);
      setAddStatus("Removing...");
      await window.mcpx.removeServer(serverName);
      setAddStatus(`Removed "${serverName}" successfully!`);
      onServerAdded();
    } catch (err) {
      setIsError(true);
      setAddStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleConfirmAdd = async (values: Record<string, string>) => {
    try {
      setIsError(false);
      setAddStatus("Adding...");
      const result = await window.mcpx.registryConfirmAdd(values);
      setAddStatus(`Added "${result.added}" successfully!`);
      setAdding(null);
      onServerAdded();
    } catch (err) {
      setIsError(true);
      setAddStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (adding) {
    return (
      <div className="browse-tab">
        <div className="detail-section__header">
          <h3>Configure {adding.shortName}</h3>
          <p className="detail-section__description">Finish the required inputs before installing this server.</p>
        </div>
        <AddServerForm
          requiredInputs={adding.requiredInputs}
          onSubmit={handleConfirmAdd}
          onCancel={() => { setAdding(null); setAddStatus(null); }}
        />
        {addStatus && <div className={`add-status ${isError ? 'add-status-error' : ''}`}>{addStatus}</div>}
      </div>
    );
  }

  const serverEntries = useMemo(() => {
    const entries = servers as Array<any>;
    if (sortBy === "default") return entries;

    return [...entries].sort((a, b) => {
      const nameA = (a.server.title ?? a.server.name).toLowerCase();
      const nameB = (b.server.title ?? b.server.name).toLowerCase();
      if (sortBy === "name") return nameA.localeCompare(nameB);
      if (sortBy === "name-desc") return nameB.localeCompare(nameA);

      const updatedA = a._meta?.["io.modelcontextprotocol.registry/official"]?.updatedAt ?? "";
      const updatedB = b._meta?.["io.modelcontextprotocol.registry/official"]?.updatedAt ?? "";
      return updatedB.localeCompare(updatedA);
    });
  }, [servers, sortBy]);

  return (
    <div className="browse-tab">
      <div className="browse-hero">
        <h2 className="browse-hero__title">Discover MCP Servers</h2>
        <p className="browse-hero__subtitle">Enhance your AI with powerful context and tools from the official MCP registry.</p>
        <form className="glass-panel browse-search" onSubmit={handleSearch}>
          <span className="material-symbols-outlined" style={{ color: "var(--text-muted)" }}>search</span>
          <input
            type="text"
            className="browse-search__input"
            placeholder="Search for tools, databases, APIs..."
            value={searchInput}
            onChange={handleSearchInputChange}
          />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
      </div>

      <div className="browse-toolbar">
        <div className="category-pills">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              className="category-pill"
              data-active={activeCategory === cat.id}
              onClick={() => handleCategoryClick(cat.id, cat.query, cat.updatedSince)}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="browse-sort">
          <label className="browse-sort__label" htmlFor="browse-sort">Sort</label>
          <select
            id="browse-sort"
            className="browse-sort__select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="default">Default</option>
            <option value="name">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="updated">Recently Updated</option>
          </select>
        </div>
      </div>

      {addStatus && <div className={`add-status ${isError ? 'add-status-error' : ''}`}>{addStatus}</div>}

      {loading && <div className="browse-empty">Loading registry...</div>}

      <div className="browse-grid">
        {serverEntries.map((entry: any) => {
          const shortName = entry.server.name.split("/").pop() ?? entry.server.name;
          const isInstalled = installedServerNames.has(shortName);
          const icon = getIcon(entry);
          const transport = getTransportLabel(entry);
          const statusBadge = getStatus(entry);
          const repoUrl = getRepoUrl(entry);
          const websiteUrl = getWebsiteUrl(entry);

          return (
            <div key={entry.server.name} className={`glass-card registry-card ${statusBadge ? "registry-card--deprecated" : ""}`}>
              {icon ? (
                <img
                  className="registry-card__icon-img"
                  src={icon.src}
                  alt=""
                  onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                />
              ) : (
                <div className="registry-card__icon">
                  <span className="material-symbols-outlined">extension</span>
                </div>
              )}
              <div className="registry-card__content">
                <div className="registry-card__title-row">
                  <h3 className="registry-card__title">{entry.server.title ?? entry.server.name}</h3>
                  {transport && <span className="registry-card__badge">{transport}</span>}
                  {statusBadge && <span className="registry-card__badge registry-card__badge--warn">{statusBadge}</span>}
                </div>
                <p className="registry-card__description">{entry.server.description || entry.server.name}</p>
                {(repoUrl || websiteUrl) && (
                  <div className="registry-card__links">
                    {repoUrl && (
                      <a className="registry-card__link" href={repoUrl} target="_blank" rel="noopener noreferrer" title={repoUrl}>
                        <span className="material-symbols-outlined">code</span> Source
                      </a>
                    )}
                    {websiteUrl && (
                      <a className="registry-card__link" href={websiteUrl} target="_blank" rel="noopener noreferrer" title={websiteUrl}>
                        <span className="material-symbols-outlined">open_in_new</span> Site
                      </a>
                    )}
                  </div>
                )}
              </div>

              {isInstalled ? (
                <div className="registry-card__actions">
                  <span className="registry-card__status">Added</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleRemove(shortName)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleAdd(entry.server.name)}
                >
                  Install
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!loading && serverEntries.length === 0 && (
        <div className="browse-empty">
          {activeQuery ? `No servers found for "${activeQuery}". Try another search.` : "No servers found."}
        </div>
      )}

      {hasMore && !loading && (
        <div className="browse-load-more-wrap">
          <button className="browse-load-more" onClick={() => loadMore(activeQuery)}>
            Load More Results
          </button>
        </div>
      )}
    </div>
  );
}
