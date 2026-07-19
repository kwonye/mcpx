import { useEffect, useState } from "react";
import { Toggle } from "./ui/Toggle";
import { formatTokenApprox } from "../utils/tokenHelper";
import { ContextBudgetCard } from "./ContextBudgetCard";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ManagedPlugin } from "@mcpx/core";

interface ServerEntry {
  name: string;
  enabled: boolean;
  transport: string;
  target: string;
  clients: Array<{ clientId: string; status: string; managed: boolean }>;
  tokenCount?: { tools: number; resources: number; prompts: number; total: number; error?: string };
}

interface ProjectEntry {
  name: string;
  path: string;
  disabledServers?: string[];
}

interface ProjectsTabProps {
  status: {
    servers: ServerEntry[];
    projects?: Record<string, ProjectEntry>;
    totalProjectTokens?: Record<string, number>;
  };
  onRefresh: () => void;
  selectedProjectPath: string | null;
  onSelectedProjectPathChange: (projectPath: string | null) => void;
}

// Utility to extract directory name from an absolute path
const getDirName = (fullPath: string): string => {
  const segments = fullPath.split(/[/\\]/);
  return segments.filter(Boolean).pop() || "";
};

export function ProjectsTab({ status, onRefresh, selectedProjectPath, onSelectedProjectPathChange }: ProjectsTabProps) {
  const [newProjectPath, setNewProjectPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; name: string } | null>(null);
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);

  const projects = Object.values(status.projects ?? {});
  const selectedProject = projects.find((p) => p.path === selectedProjectPath) ?? null;

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

  // Handle opening directory selector
  const handleSelectDirectory = async () => {
    setError(null);
    setSuccess(null);
    try {
      const selected = await window.mcpx.selectDirectory();
      if (selected) {
        setNewProjectPath(selected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open directory picker");
    }
  };

  // Handle adding/initializing a project
  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPath = newProjectPath.trim();
    if (!cleanPath) {
      setError("Please select a project directory.");
      return;
    }

    const inferredName = getDirName(cleanPath);
    if (!inferredName) {
      setError("Could not infer project name from the selected path.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await window.mcpx.projectInit(cleanPath, inferredName);
      setSuccess(`Project "${inferredName}" successfully registered.`);
      setNewProjectPath("");
      onSelectedProjectPathChange(cleanPath);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize project");
    } finally {
      setLoading(false);
    }
  };

  // Handle removing/unregistering a project
  const handleRemoveProject = async (projectPath: string, name: string) => {
    setConfirmDelete({ path: projectPath, name });
  };

  const handleConfirmRemove = async () => {
    if (!confirmDelete) return;
    const { path, name } = confirmDelete;
    setConfirmDelete(null);
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await window.mcpx.projectRemove(path);
      setSuccess(`Project "${name}" unregistered successfully.`);
      if (selectedProjectPath === path) {
        onSelectedProjectPathChange(null);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unregister project");
    } finally {
      setLoading(false);
    }
  };

  // For the selected project, effective enabled = globally enabled AND not in project's disabledServers
  const disabledServers = new Set(selectedProject?.disabledServers ?? []);
  const catalogServers = status.servers;

  const handleToggleServer = async (serverName: string, effectiveEnabled: boolean) => {
    if (!selectedProject) return;
    try {
      await window.mcpx.setProjectServerEnabled(selectedProject.path, serverName, !effectiveEnabled);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle server state");
    }
  };

  const handleTogglePlugin = async (plugin: ManagedPlugin, effectiveEnabled: boolean) => {
    if (!selectedProject) return;
    try {
      await window.mcpx.plugins.setProjectOverride(plugin.id, selectedProject.path, { enabled: !effectiveEnabled });
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle plugin state");
    }
  };

  return (
    <><div className="projects-tab-container">
      {error && <div className="feedback-message error mb-4">{error}</div>}
      {success && <div className="feedback-message success mb-4">{success}</div>}

      <div className="projects-layout">
        <div className="project-detail-column">
          {selectedProject ? (
            <div className="project-detail-card">
              <div className="project-detail-header-row">
                <div>
                  <div className="detail-eyebrow">Project Context</div>
                  <h2>{selectedProject.name}</h2>
                </div>
                <div className="project-detail-actions">
                  {typeof status.totalProjectTokens?.[selectedProject.path] === "number" && (
                    <div className="token-badge-total" title="Context window tokens consumed by enabled MCP servers in this project">
                      <span className="material-symbols-outlined font-icon-sm">analytics</span>
                      <span>{formatTokenApprox(status.totalProjectTokens[selectedProject.path])} Project Tokens Active</span>
                    </div>
                  )}
                  <button
                    className="btn-icon-danger"
                    title="Unregister project"
                    onClick={() => handleRemoveProject(selectedProject.path, selectedProject.name)}
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
                <span className="detail-path-badge mono-text">{selectedProject.path}</span>
              </div>

              {typeof status.totalProjectTokens?.[selectedProject.path] === "number" && (
                <div>
                  <ContextBudgetCard totalTokens={status.totalProjectTokens[selectedProject.path]} />
                </div>
              )}

              <div className="project-mcp-section">
                <h3>MCP Servers</h3>
                <p className="section-description">
                  These are your global MCP servers. Toggle each one on or off for this project specifically.
                  Disabling a server here only affects this project — it stays on globally for other directories.
                </p>

                {catalogServers.length === 0 ? (
                  <div className="empty-mcp-placeholder">
                    <span className="material-symbols-outlined">info</span>
                    <p>No MCP servers configured yet.</p>
                    <p className="hint">
                      Add servers from the Servers tab.
                    </p>
                  </div>
                ) : (
                  <div className="project-mcp-list">
                    {catalogServers.map((server) => {
                      const effectiveEnabled = server.enabled && !disabledServers.has(server.name);
                      const globallyDisabled = !server.enabled;
                      return (
                        <div key={server.name} className="project-mcp-row">
                          <div className="project-mcp-info">
                            <div className="project-mcp-name-row">
                              <span className="mcp-name">{server.name}</span>
                              <span className="mcp-transport-badge">{server.transport}</span>
                              {effectiveEnabled && server.tokenCount && server.tokenCount.total > 0 && (
                                <span className="token-badge" title={`${server.tokenCount.tools} tools, ${server.tokenCount.resources} resources, ${server.tokenCount.prompts} prompts`}>
                                  {formatTokenApprox(server.tokenCount.total)} tokens
                                </span>
                              )}
                              {effectiveEnabled && server.tokenCount?.error && (
                                <span className="token-badge token-badge--error" title={server.tokenCount.error}>
                                  token error
                                </span>
                              )}
                              {globallyDisabled && (
                                <span className="mcp-transport-badge" title="Globally disabled — enabling here will turn it on globally">
                                  globally off
                                </span>
                              )}
                            </div>
                            <span className="mcp-target-command mono-text" title={server.target}>
                              {server.target}
                            </span>
                          </div>

                          <div className="project-mcp-controls">
                            <div className="toggle-container">
                              <span className="toggle-status-label">
                                {effectiveEnabled ? "Enabled" : "Disabled"}
                              </span>
                              <Toggle
                                  id={`toggle-${server.name}`}
                                  checked={effectiveEnabled}
                                  onChange={() => handleToggleServer(server.name, effectiveEnabled)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="project-mcp-section">
                <h3>Plugins</h3>
                <p className="section-description">
                  These are your installed plugins. Toggle each one on or off for this project specifically.
                  Changing it here only affects this project — the plugin stays as configured globally for other directories.
                </p>

                {plugins.length === 0 ? (
                  <div className="empty-mcp-placeholder">
                    <span className="material-symbols-outlined">info</span>
                    <p>No plugins installed.</p>
                    <p className="hint">
                      Install plugins from the Plugins tab.
                    </p>
                  </div>
                ) : (
                  <div className="project-mcp-list">
                    {plugins.map((plugin) => {
                      const effectiveEnabled = plugin.projectOverrides?.[selectedProject.path]?.enabled ?? plugin.enabled;
                      return (
                        <div key={plugin.id} className="project-mcp-row">
                          <div className="project-mcp-info">
                            <div className="project-mcp-name-row">
                              <span className="mcp-name">{plugin.name}</span>
                              <span className="mcp-transport-badge">v{plugin.version}</span>
                            </div>
                            <span className="mcp-target-command mono-text" title={plugin.source}>
                              {plugin.source}
                            </span>
                          </div>

                          <div className="project-mcp-controls">
                            <div className="toggle-container">
                              <span className="toggle-status-label">
                                {effectiveEnabled ? "Enabled" : "Disabled"}
                              </span>
                              <Toggle
                                  id={`toggle-plugin-${plugin.id}`}
                                  checked={effectiveEnabled}
                                  onChange={() => handleTogglePlugin(plugin, effectiveEnabled)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="project-detail-empty">
              <span className="material-symbols-outlined empty-icon">folder_zip</span>
              <h3>{projects.length > 0 ? "Select a Project" : "No Projects Registered"}</h3>
              <p>{projects.length > 0 ? "Choose a project from the sidebar to manage its MCP server visibility." : "Register a folder to customize which MCP servers are active in that directory."}</p>
              <form onSubmit={handleAddProject} className="project-form project-form--empty">
                <div className="directory-picker-row">
                  <input
                    type="text"
                    className="glass-input text-sm mono-text"
                    value={newProjectPath}
                    placeholder="No folder selected"
                    readOnly
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm picker-btn"
                    onClick={handleSelectDirectory}
                    disabled={loading}
                  >
                    <span className="material-symbols-outlined font-icon-sm">folder_open</span>
                    Choose Folder
                  </button>
                </div>
                {newProjectPath && (
                  <div className="inferred-name-preview">
                    <span className="label">Inferred Name:</span>
                    <span className="badge-pill">{getDirName(newProjectPath)}</span>
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-sm" disabled={loading || !newProjectPath}>
                  <span className="material-symbols-outlined font-icon-sm">add_box</span>
                  Add Project
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={confirmDelete !== null}
      title="Unregister project?"
      message={confirmDelete ? `Are you sure you want to unregister project "${confirmDelete.name}"? This won't delete any files, but it will remove it from mcpx.` : ""}
      confirmLabel="Unregister"
      destructive
      onConfirm={handleConfirmRemove}
      onCancel={() => setConfirmDelete(null)}
    /></>
  );
}
