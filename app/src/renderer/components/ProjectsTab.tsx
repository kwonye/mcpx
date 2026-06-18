import { useState } from "react";
import { Toggle } from "./ui/Toggle";
import { formatTokenApprox } from "../utils/tokenHelper";
import { ContextBudgetCard } from "./ContextBudgetCard";

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

  const projects = Object.values(status.projects ?? {});
  const selectedProject = projects.find((p) => p.path === selectedProjectPath) ?? null;

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
    if (!confirm(`Are you sure you want to unregister project "${name}"?\nThis won't delete the local .mcpx.json file, but it will remove it from mcpx.`)) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await window.mcpx.projectRemove(projectPath);
      setSuccess(`Project "${name}" unregistered successfully.`);
      if (selectedProjectPath === projectPath) {
        onSelectedProjectPathChange(null);
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unregister project");
    } finally {
      setLoading(false);
    }
  };

  const projectServers = selectedProject
    ? status.servers.filter((server) => {
        return server.name.startsWith(`${selectedProject.name}.`);
      })
    : [];

  const handleToggleServer = async (fullName: string, currentEnabled: boolean) => {
    try {
      await window.mcpx.setServerEnabled(fullName, !currentEnabled);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle server state");
    }
  };

  return (
    <div className="projects-tab-container">
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
                    <div className="token-badge-total" title="Context window tokens consumed by project-specific enabled MCP servers">
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
                <h3>Project-Specific MCP Servers</h3>
                <p className="section-description">
                  These servers are declared in the project's local `.mcpx.json` config.
                </p>

                {projectServers.length === 0 ? (
                  <div className="empty-mcp-placeholder">
                    <span className="material-symbols-outlined">info</span>
                    <p>No project-specific servers configured yet.</p>
                    <p className="hint">
                      Add servers locally by running: <br />
                      <code className="inline-code">mcpx add &lt;name&gt; &lt;command&gt;</code> inside this directory.
                    </p>
                  </div>
                ) : (
                  <div className="project-mcp-list">
                    {projectServers.map((server) => {
                      const baseName = server.name.slice(selectedProject.name.length + 1);
                      return (
                        <div key={server.name} className="project-mcp-row">
                          <div className="project-mcp-info">
                            <div className="project-mcp-name-row">
                              <span className="mcp-name">{baseName}</span>
                              <span className="mcp-transport-badge">{server.transport}</span>
                              {server.enabled && server.tokenCount && server.tokenCount.total > 0 && (
                                <span className="token-badge" title={`${server.tokenCount.tools} tools, ${server.tokenCount.resources} resources, ${server.tokenCount.prompts} prompts`}>
                                  {formatTokenApprox(server.tokenCount.total)} tokens
                                </span>
                              )}
                              {server.enabled && server.tokenCount?.error && (
                                <span className="token-badge token-badge--error" title={server.tokenCount.error}>
                                  token error
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
                                {server.enabled ? "Enabled" : "Disabled"}
                              </span>
                              <Toggle
                                  id={`toggle-${server.name}`}
                                  checked={server.enabled}
                                  onChange={() => handleToggleServer(server.name, server.enabled)}
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
              <p>{projects.length > 0 ? "Choose a project from the sidebar to manage its directory-specific MCP context." : "Register a folder to start using project-local MCP servers."}</p>
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
  );
}
