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
  const supportedCommands = [
    "claude mcp add",
    "codex mcp add",
    "qwen mcp add",
    "code --add-mcp",
    "mcpx add"
  ];

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
    <div className="glass-panel cli-command-panel">
      <form onSubmit={handleSubmit} className="cli-command-form">
        <div className="form-field">
          <label htmlFor="cli-command">Paste your mcpx add command</label>
          <div className="cli-command-row">
            <div className="cli-command-input-wrap">
              <span className="material-symbols-outlined cli-command-icon">terminal</span>
              <input
                id="cli-command"
                className="glass-input mono-text cli-command-input"
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Paste your mcpx add command here..."
                disabled={loading}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !command.trim()}>
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ animation: "spin 1s linear infinite" }}>progress_activity</span>
                  Adding...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">add</span>
                  Add Server
                </>
              )}
            </button>
          </div>
          <div className="field-description">
            <span>Supports:</span>
            <ul className="cli-command-supports" aria-label="Supported commands">
              {supportedCommands.map((supportedCommand) => (
                <li key={supportedCommand} className="cli-command-support-item">
                  <code className="inline-code">{supportedCommand}</code>
                </li>
              ))}
            </ul>
            <span className="cli-command-example">Example: claude mcp add slack --transport http https://mcp.slack.com/mcp</span>
          </div>
        </div>

        {error && <div className="feedback-message error">{error}</div>}
        {success && <div className="feedback-message success">{success}</div>}
      </form>
    </div>
  );
}
