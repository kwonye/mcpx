import { useState } from "react";
import { IPC } from "../../shared/ipc-channels";

interface CliCommandInputProps {
  onServerAdded: () => void;
}

export function CliCommandInput({ onServerAdded }: CliCommandInputProps) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await window.mcpx.invoke(IPC.EXECUTE_CLI_COMMAND, command);
      setSuccess(`Successfully added "${result.added}"`);
      setCommand("");
      onServerAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute command");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-panel" style={{ padding: "16px", borderRadius: "16px", marginBottom: "24px" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div className="form-field">
          <label htmlFor="cli-command" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-main)" }}>Paste your mcpx add command</label>
          <div style={{ display: "flex", gap: "12px", width: "100%", marginTop: "4px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span className="material-symbols-outlined" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "18px" }}>terminal</span>
              <input
                id="cli-command"
                className="glass-input"
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Paste your mcpx add command here..."
                disabled={loading}
                autoFocus
                style={{ width: "100%", padding: "12px 16px 12px 40px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "13px" }}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !command.trim()} style={{ whiteSpace: "nowrap" }}>
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px", animation: "spin 1s linear infinite" }}>progress_activity</span>
                  Adding...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>add</span>
                  Add Server
                </>
              )}
            </button>
          </div>
          <p className="field-description" style={{ marginTop: "4px" }}>
            Supports: <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>claude mcp add</code>, <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>codex mcp add</code>, <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>qwen mcp add</code>, <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>code --add-mcp</code>, <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>mcpx add</code>
            <br />
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>Example: claude mcp add slack --transport http https://mcp.slack.com/mcp</span>
          </p>
        </div>

        {error && <div style={{ padding: "12px 16px", background: "rgba(239, 68, 68, 0.1)", color: "var(--error)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "12px", fontSize: "13px", fontWeight: 500 }}>{error}</div>}
        {success && <div style={{ padding: "12px 16px", background: "rgba(52, 199, 89, 0.1)", color: "var(--success)", border: "1px solid rgba(52, 199, 89, 0.2)", borderRadius: "12px", fontSize: "13px", fontWeight: 500 }}>{success}</div>}
      </form>
    </div>
  );
}
