import { useState } from "react";
import { IPC } from "../../shared/ipc-channels";

interface CliCommandInputProps {
  onServerAdded: () => void;
}

export function CliCommandInput({ onServerAdded }: CliCommandInputProps): JSX.Element {
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
    <div className="cli-command-input">
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="cli-command">Paste your mcpx add command</label>
          <input
            id="cli-command"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g., claude mcp add slack --transport http https://mcp.slack.com/mcp"
            disabled={loading}
            autoFocus
          />
          <p className="field-description">
            Supports: <code>claude mcp add</code>, <code>codex mcp add</code>, <code>qwen mcp add</code>, <code>code --add-mcp</code>, <code>mcpx add</code>
          </p>
        </div>

        {error && <div className="add-status add-status-error">{error}</div>}
        {success && <div className="add-status">{success}</div>}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading || !command.trim()}>
            {loading ? "Adding..." : "Add Server"}
          </button>
        </div>
      </form>
    </div>
  );
}
