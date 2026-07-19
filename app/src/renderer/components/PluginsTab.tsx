import { useEffect, useState } from "react";
import { SkillsTab } from "./SkillsTab";
import type { ManagedPlugin, PluginComponent } from "@mcpx/core";

export function PluginsTab() {
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [installInput, setInstallInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  async function loadPlugins() {
    try {
      const list = await window.mcpx.plugins.list();
      setPlugins(list as ManagedPlugin[]);
    } catch (err) {
      setPlugins([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    loadPlugins();
  }, []);

  async function handleInstall(e: React.FormEvent) {
    e.preventDefault();
    if (!installInput.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await window.mcpx.plugins.install(installInput.trim());
      setInstallInput("");
      await loadPlugins();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  async function handleToggle(plugin: ManagedPlugin) {
    setError(null);
    try {
      if (plugin.enabled) {
        await window.mcpx.plugins.disable(plugin.id);
      } else {
        await window.mcpx.plugins.enable(plugin.id);
      }
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleApprove(pluginId: string, component: string) {
    setError(null);
    try {
      await window.mcpx.plugins.approve(pluginId, component);
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUninstall(plugin: ManagedPlugin) {
    if (!confirm(`Uninstall plugin "${plugin.name}"?`)) return;
    setError(null);
    try {
      await window.mcpx.plugins.uninstall(plugin.id, { keepData: true });
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUpdate(plugin: ManagedPlugin) {
    setError(null);
    try {
      await window.mcpx.plugins.update(plugin.id);
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const gatedComponents = ["hooks", "commands", "mcpServers"] as const;

  return (
    <div className="plugins-tab">
      <div className="page-header page-header--split">
        <h1 className="page-title">Plugins</h1>
      </div>

      <form onSubmit={handleInstall} className="plugin-install-row">
        <input
          type="text"
          className="glass-input plugin-install-input"
          placeholder="GitHub URL / owner/repo / local path"
          value={installInput}
          onChange={(e) => setInstallInput(e.target.value)}
          disabled={installing}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={installing || !installInput.trim()}
        >
          {installing ? "Installing..." : "Install"}
        </button>
      </form>
      {installError && <div className="plugin-install-error">{installError}</div>}

      {error && <div className="feedback-message error">{error}</div>}

      {plugins.length === 0 && (
        <div className="empty-state">
          <p>No plugins installed.</p>
        </div>
      )}

      <div className="plugin-list">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-card">
            <div className="plugin-card__header">
              <div className="plugin-card__title-row">
                <span className="plugin-card__name">{plugin.name}</span>
                <span className="plugin-card__version">v{plugin.version}</span>
                <span className={`plugin-card__status ${plugin.status === "error" ? "plugin-card__status--error" : ""}`}>
                  {plugin.status === "error" ? "error" : plugin.status}
                </span>
                {plugin.status === "error" && plugin.error && (
                  <span className="plugin-card__error-text" title={plugin.error}>⚠</span>
                )}
              </div>
              <div className="plugin-card__source">{plugin.source}</div>
            </div>

            <div className="plugin-card__controls">
              <label className="toggle-label plugin-toggle">
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={plugin.enabled}
                  onChange={() => handleToggle(plugin)}
                />
                <span className="toggle-label-inner" />
              </label>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => toggleExpanded(plugin.id)}
              >
                {expanded.has(plugin.id) ? "Less" : "More"}
              </button>
            </div>

            {expanded.has(plugin.id) && (
              <div className="plugin-card__detail">
                <div className="plugin-card__components">
                  {Object.entries(plugin.components).filter(([, v]) => v).map(([key]) => {
                    const needsApproval = gatedComponents.includes(key as typeof gatedComponents[number])
                      && plugin.approvals?.[key as PluginComponent] !== true;
                    return (
                      <span key={key} className="plugin-component-chip">
                        {key}
                        {needsApproval && (
                          <button
                            type="button"
                            className="plugin-approve-btn"
                            onClick={() => handleApprove(plugin.id, key)}
                            title="Approve this component"
                          >
                            Approve
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>

                {plugin.discovered.mcpServers.length > 0 && (
                  <div className="plugin-card__servers">
                    <strong>Servers:</strong>
                    <ul>
                      {plugin.discovered.mcpServers.map((srv) => (
                        <li key={srv.id}>{srv.id}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="plugin-card__footer">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleUpdate(plugin)}
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleUninstall(plugin)}
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <SkillsTab />
    </div>
  );
}
