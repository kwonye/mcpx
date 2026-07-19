import { useState } from "react";
import { IPC } from "../../shared/ipc-channels";
import { AUTO_DISMISS_DELAY_MS, useAutoDismiss } from "../hooks/useAutoDismiss";

interface CompactCliInputProps {
  onServerAdded: () => void;
}

export function CompactCliInput({ onServerAdded }: CompactCliInputProps) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useAutoDismiss<string>(AUTO_DISMISS_DELAY_MS);
  const [success, setSuccess] = useAutoDismiss<string>(AUTO_DISMISS_DELAY_MS);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await window.mcpx.invoke(IPC.EXECUTE_CLI_COMMAND, command);
      setCommand("");
      onServerAdded();
      if (result.authRequired) {
        setSuccess(`Added "${result.added}" — auth required, opening dashboard...`);
        window.mcpx.openDashboard();
      } else {
        setSuccess(`Added "${result.added}"`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="compact-cli-input">
      <div className="compact-cli-input__title">Add Server</div>
      <form onSubmit={handleSubmit}>
        <div className="compact-cli-input__row">
          <input
            className="compact-cli-input__field"
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            aria-label="Paste your mcpx add command"
            placeholder="Paste your mcpx add command here..."
            disabled={loading}
          />
          <button
            type="submit"
            className="compact-cli-input__btn"
            disabled={loading || !command.trim()}
          >
            {loading ? (
              "Adding..."
            ) : (
              <>
                <span className="material-symbols-outlined">add</span>
                Add
              </>
            )}
          </button>
        </div>
        {error && <div className="compact-cli-input__feedback error">{error}</div>}
        {success && <div className="compact-cli-input__feedback success">{success}</div>}
      </form>
    </div>
  );
}
