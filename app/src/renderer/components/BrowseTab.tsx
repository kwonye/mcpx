import { useState, useEffect } from "react";
import { useRegistryList } from "../hooks/useMcpx";
import { AddServerForm } from "./AddServerForm";

interface BrowseTabProps {
  onServerAdded: () => void;
  status: {
    servers: Array<{ name: string }>;
  };
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

export function BrowseTab({ onServerAdded, status }: BrowseTabProps) {
  const { servers, loading, search, debouncedSearch, loadMore, hasMore } = useRegistryList();
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

  const installedServerNames = new Set(status.servers.map(s => s.name));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedQuery = searchInput.trim();
    setActiveCategory("");
    setActiveQuery(normalizedQuery);
    search(normalizedQuery);  // Immediate search on form submit
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

  const serverEntries = servers as Array<{ server: { name: string; title?: string; description?: string } }>;

  return (
    <div className="browse-tab">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: "32px", marginTop: "16px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.02em", marginBottom: "12px" }}>Discover MCP Servers</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "15px", maxWidth: "500px", marginBottom: "32px" }}>Enhance your AI with powerful context and tools from the official registry.</p>
        <form className="glass-panel" onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: "600px", height: "56px", borderRadius: "28px", padding: "0 8px 0 20px", transition: "all 0.2s ease", position: "relative" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--text-muted)", fontSize: "24px" }}>search</span>
          <input
            type="text"
            placeholder="Search for tools, databases, APIs..."
            value={searchInput}
            onChange={handleSearchInputChange}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-main)", fontSize: "15px", padding: "0 16px" }}
          />
          <button type="submit" className="btn btn-primary" style={{ height: "40px", borderRadius: "20px", padding: "0 24px", fontWeight: 600 }}>Search</button>
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

      <div className="browse-grid">
        {serverEntries.map((entry) => {
          const shortName = entry.server.name.split("/").pop() ?? entry.server.name;
          const isInstalled = installedServerNames.has(shortName);

          return (
            <div key={entry.server.name} className="glass-card" style={{ minHeight: "80px", width: "100%", borderRadius: "16px", display: "flex", alignItems: "center", padding: "16px 20px", cursor: "pointer", transition: "all 0.15s ease-in-out" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "rgba(83, 80, 241, 0.1)", border: "1px solid rgba(255, 255, 255, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ color: "var(--primary)" }}>extension</span>
              </div>
              <div style={{ marginLeft: "16px", flex: 1, minWidth: 0, paddingRight: "16px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.server.title ?? entry.server.name}</h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.server.description || entry.server.name}</p>
              </div>

              {isInstalled ? (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                  <span style={{ fontSize: "13px", color: "var(--success)", fontWeight: 600 }}>Added</span>
                  <button
                    className="btn btn-danger"
                    style={{ height: "32px", padding: "0 16px", fontSize: "13px", fontWeight: 600 }}
                    onClick={() => handleRemove(shortName)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="btn"
                  style={{ flexShrink: 0, height: "32px", padding: "0 16px", borderRadius: "8px", background: "rgba(83, 80, 241, 0.1)", color: "var(--primary)", fontSize: "13px", fontWeight: 600, transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--primary)"; e.currentTarget.style.color = "white"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(83, 80, 241, 0.1)"; e.currentTarget.style.color = "var(--primary)"; }}
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
        <div style={{ display: "flex", justifyContent: "center", marginTop: "32px", width: "100%" }}>
          <button className="browse-load-more" onClick={() => loadMore(activeQuery)}>
            Load More Results
          </button>
        </div>
      )}
    </div>
  );
}
