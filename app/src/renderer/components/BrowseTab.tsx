import { useState } from "react";
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

export function BrowseTab({ onServerAdded }: BrowseTabProps): JSX.Element {
  const { servers, loading, search, loadMore, hasMore } = useRegistryList();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<{
    registryName: string;
    shortName: string;
    requiredInputs: RequiredInput[];
  } | null>(null);
  const [addStatus, setAddStatus] = useState<string | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    search(query || undefined);
  };

  const handleAdd = async (registryName: string) => {
    try {
      setAddStatus("Preparing...");
      const result = await window.mcpx.registryPrepareAdd(registryName);
      if (result.requiredInputs.length === 0) {
        // No inputs needed — add directly
        const addResult = await window.mcpx.registryConfirmAdd({});
        setAddStatus(`Added "${addResult.added}"`);
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
      setAddStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleConfirmAdd = async (values: Record<string, string>) => {
    try {
      setAddStatus("Adding...");
      const result = await window.mcpx.registryConfirmAdd(values);
      setAddStatus(`Added "${result.added}"`);
      setAdding(null);
      onServerAdded();
    } catch (err) {
      setAddStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (adding) {
    return (
      <div className="browse-tab">
        <h3>Configure {adding.shortName}</h3>
        <AddServerForm
          requiredInputs={adding.requiredInputs}
          onSubmit={handleConfirmAdd}
          onCancel={() => { setAdding(null); setAddStatus(null); }}
        />
        {addStatus && <div className="add-status">{addStatus}</div>}
      </div>
    );
  }

  return (
    <div className="browse-tab">
      <form className="browse-search" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search MCP servers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {addStatus && <div className="add-status">{addStatus}</div>}

      {loading && <div className="browse-loading">Loading...</div>}

      <div className="browse-results">
        {(servers as Array<{ server: { name: string; title?: string; description?: string } }>).map((entry) => (
          <div key={entry.server.name} className="browse-card">
            <div className="browse-card-header">
              <span className="browse-card-name">{entry.server.title ?? entry.server.name}</span>
            </div>
            {entry.server.description && (
              <div className="browse-card-description">{entry.server.description}</div>
            )}
            <button className="browse-card-add" onClick={() => handleAdd(entry.server.name)}>
              Add
            </button>
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <button className="browse-load-more" onClick={() => loadMore(query || undefined)}>
          Load More
        </button>
      )}
    </div>
  );
}
