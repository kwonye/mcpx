import { useState, useEffect, useRef } from "react";
import { useRegistryList } from "../hooks/useMcpx";
import { AddServerForm } from "./AddServerForm";

// Feature flag: disable browse registry search (temporarily disabled)
const BROWSE_SEARCH_ENABLED = false;

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

const CATEGORIES = [
  { id: "all", label: "All Servers", query: "" },
  { id: "trending", label: "Trending 🔥", query: "browser agent sqlite" },
  { id: "databases", label: "Databases 💾", query: "postgres sqlite neon mysql" },
  { id: "devtools", label: "Developer Tools 🛠️", query: "github git fetch" },
  { id: "web", label: "Web & Browser 🌐", query: "puppeteer brave browser" }
];

export function BrowseTab({ onServerAdded, status, initialState, onStateChange }: BrowseTabProps) {
  const { servers, loading, search, debouncedSearch, loadMore, hasMore } = useRegistryList();
  const [searchInput, setSearchInput] = useState(initialState?.searchQuery ?? "");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(initialState?.activeCategory ?? "all");
  const [adding, setAdding] = useState<{
    registryName: string;
    shortName: string;
    requiredInputs: RequiredInput[];
  } | null>(null);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const initialSearchTriggered = useRef(false);

  const installedServerNames = new Set(status.servers.map(s => s.name));

  // Trigger initial search on mount if initialState has searchQuery or activeCategory
  useEffect(() => {
    if (initialSearchTriggered.current) return;
    initialSearchTriggered.current = true;

    if (initialState?.searchQuery) {
      const query = initialState.searchQuery.trim();
      setActiveQuery(query);
      search(query);
    } else if (initialState?.activeCategory && initialState.activeCategory !== "all") {
      // Find the category query for the persisted category
      const category = CATEGORIES.find(c => c.id === initialState.activeCategory);
      if (category) {
        setActiveQuery(category.query);
        search(category.query);
      }
    }
  }, [initialState, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedQuery = searchInput.trim();
    setActiveCategory("");
    setActiveQuery(normalizedQuery);
    search(normalizedQuery);  // Immediate search on form submit
    // Persist state on explicit search action
    onStateChange?.({ searchQuery: normalizedQuery, activeCategory: "" });
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    setActiveCategory("");
    debouncedSearch(value);  // Debounced real-time search
  };

  const handleCategoryClick = (categoryId: string, categoryQuery: string) => {
    setActiveCategory(categoryId);
    setSearchInput("");
    setActiveQuery(categoryQuery);
    search(categoryQuery);
    // Persist state on category selection
    onStateChange?.({ searchQuery: "", activeCategory: categoryId });
  };

  const handleAdd = async (registryName: string) => {
    try {
      setIsError(false);
      setAddStatus("Preparing...");
      const result = await window.mcpx.registryPrepareAdd(registryName);
      if (result.requiredInputs.length === 0) {
        // No inputs needed — add directly
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
      onServerAdded(); // Refresh status
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

  const serverEntries = servers as Array<{ server: { name: string; title?: string; description?: string } }>;

  return (
    <div className="browse-tab">
      <div className="browse-hero">
        <h2 className="browse-hero__title">Discover MCP Servers</h2>
        <p className="browse-hero__subtitle">Enhance your AI with powerful context and tools from the official MCP registry.</p>
        {BROWSE_SEARCH_ENABLED && (
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
        )}
      </div>

      <div className="category-pills">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            type="button"
            className="category-pill"
            data-active={activeCategory === cat.id}
            onClick={() => handleCategoryClick(cat.id, cat.query)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {addStatus && <div className={`add-status ${isError ? 'add-status-error' : ''}`}>{addStatus}</div>}

      {loading && <div className="browse-empty">Loading registry...</div>}

      <div className="browse-grid">
        {serverEntries.map((entry) => {
          const shortName = entry.server.name.split("/").pop() ?? entry.server.name;
          const isInstalled = installedServerNames.has(shortName);

          return (
            <div key={entry.server.name} className="glass-card registry-card">
              <div className="registry-card__icon">
                <span className="material-symbols-outlined">extension</span>
              </div>
              <div className="registry-card__content">
                <h3 className="registry-card__title">{entry.server.title ?? entry.server.name}</h3>
                <p className="registry-card__description">{entry.server.description || entry.server.name}</p>
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
