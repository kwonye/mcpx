import { useState, useEffect } from "react";
import { useRegistryList } from "../hooks/useMcpx";
import { AddServerForm } from "./AddServerForm";

interface BrowseTabProps {
  onServerAdded: () => void;
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

export function BrowseTab({ onServerAdded }: BrowseTabProps) {
  const { servers, loading, search, loadMore, hasMore } = useRegistryList();
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [adding, setAdding] = useState<{
    registryName: string;
    shortName: string;
    requiredInputs: RequiredInput[];
  } | null>(null);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    search(undefined);
  }, [search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveCategory("");
    setActiveQuery(searchInput);
    search(searchInput || undefined);
  };

  const handleCategoryClick = (categoryId: string, categoryQuery: string) => {
    setActiveCategory(categoryId);
    setSearchInput("");
    setActiveQuery(categoryQuery);
    search(categoryQuery || undefined);
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
        <h3 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Configure {adding.shortName}</h3>
        <AddServerForm
          requiredInputs={adding.requiredInputs}
          onSubmit={handleConfirmAdd}
          onCancel={() => { setAdding(null); setAddStatus(null); }}
        />
        {addStatus && <div className={`add-status ${isError ? 'add-status-error' : ''}`}>{addStatus}</div>}
      </div>
    );
  }

  return (
    <div className="browse-tab">
      <div className="browse-hero">
        <h2>Discover MCP Servers</h2>
        <p>Enhance your AI with powerful context and tools from the official registry.</p>
        <form className="browse-search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search for tools, databases, APIs..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
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

      {loading && <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: "40px" }}>Loading registry...</div>}

      <div className="browse-results">
        {(servers as Array<{ server: { name: string; title?: string; description?: string } }>).map((entry) => (
          <div key={entry.server.name} className="browse-card">
            <div className="browse-card-header">
              <span className="browse-card-name">{entry.server.title ?? entry.server.name}</span>
              <button className="browse-card-add" onClick={() => handleAdd(entry.server.name)}>
                Add Server
              </button>
            </div>
            {entry.server.description && (
              <div className="browse-card-description">{entry.server.description}</div>
            )}
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "32px", width: "100%" }}>
          <button className="browse-load-more" onClick={() => loadMore(activeQuery || undefined)}>
            Load More Results
          </button>
        </div>
      )}
    </div>
  );
}
