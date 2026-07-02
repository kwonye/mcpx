import { useState, useEffect } from "react";
import logoSvg from "../assets/logo.svg";
import { useStatus } from "../hooks/useMcpx";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";
import { AuthModal } from "./AuthModal";
import { SkillsTab } from "./SkillsTab";
import { PluginsTab } from "./PluginsTab";
import { DaemonControls } from "./DaemonControls";
import { SettingsPanel } from "./SettingsPanel";
import { CliCommandInput } from "./CliCommandInput";
import type { DesktopTab } from "../../shared/desktop-settings";
import { DESKTOP_MANAGER_NAME } from "../../shared/build-constants";
import { ProjectsTab } from "./ProjectsTab";
import { formatTokenApprox } from "../utils/tokenHelper";
import { ContextBudgetCard } from "./ContextBudgetCard";

type PendingAuthEntry = { serverName: string; oauthLikely?: boolean; status?: number };
const VALID_TABS: DesktopTab[] = ["servers", "projects", "plugins", "settings"];

export function Dashboard() {
  const { status, loading, refresh } = useStatus();
  const [tab, setTab] = useState<DesktopTab>("servers");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<PendingAuthEntry | null>(null);

  useEffect(() => {
    const pendingAuthPromise = window.mcpx.getPendingAuth?.();
    if (!pendingAuthPromise) {
      return;
    }

    pendingAuthPromise.then((result: PendingAuthEntry | PendingAuthEntry[] | null) => {
      const entry = Array.isArray(result) ? result[0] : result;
      if (entry) {
        setPendingAuth(entry);
      }
    }).catch(() => {
      // Handler may not be registered yet — ignore
    });

    return window.mcpx.onAuthRequired?.((entry: PendingAuthEntry) => {
      setPendingAuth(entry);
    });
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await window.mcpx.getDesktopSettings();
        const activeTab = settings.activeTab === "skills" ? "plugins" : settings.activeTab;
        if (activeTab && VALID_TABS.includes(activeTab)) {
          setTab(activeTab);
        }
      } catch {
        // Use defaults if settings fail to load
      }
      setSettingsLoaded(true);
    }
    loadSettings();
  }, []);

  const handleTabChange = async (newTab: DesktopTab) => {
    setTab(newTab);
    setSelectedServer(null);
    try {
      await window.mcpx.updateDesktopSettings({ activeTab: newTab });
    } catch {
      // Ignore persistence errors
    }
  };

  if (loading || !status || !settingsLoaded) {
    return (
      <div className="dashboard-container dashboard-loading">
        Loading...
      </div>
    );
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    servers: Array<{
      name: string;
      enabled: boolean;
      transport: string;
      target: string;
      authBindings: Array<{ kind: string; key: string; value: string }>;
      clients: Array<{ clientId: string; status: string; managed: boolean }>;
      tokenCount?: { tools: number; resources: number; prompts: number; total: number; error?: string; runtimeError?: string };
    }>;
    projects?: Record<string, { name: string; path: string }>;
    totalGlobalTokens?: number;
    totalProjectTokens?: Record<string, number>;
  };

  const activeServer = selectedServer ? report.servers.find((s) => s.name === selectedServer) : null;
  const projects = Object.values(report.projects ?? {}).sort((left, right) => left.name.localeCompare(right.name));

  function getProjectServers(projectName: string) {
    return report.servers.filter((server) => server.name.startsWith(`${projectName}.`));
  }

  function toggleProject(path: string): void {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function selectProject(path: string): void {
    setSelectedProjectPath(path);
    void handleTabChange("projects");
  }

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logoSvg} alt="mcpx" className="sidebar-logo-icon" />
          <span className="sidebar-logo-text">{DESKTOP_MANAGER_NAME}</span>
        </div>
        <DaemonControls daemon={report.daemon} onRefresh={refresh} />
        <div className="sidebar-inner glass-panel">
          <button
            className="nav-button"
            data-active={tab === "servers"}
            onClick={() => handleTabChange("servers")}
          >
            <span className="material-symbols-outlined">grid_view</span>
            <span className="nav-button__label">My Servers</span>
          </button>
          <button
            className="nav-button"
            data-active={tab === "projects"}
            onClick={() => {
              if (!selectedProjectPath && projects[0]) {
                setSelectedProjectPath(projects[0].path);
              }
              void handleTabChange("projects");
            }}
          >
            <span className="material-symbols-outlined">folder</span>
            <span className="nav-button__label">Projects</span>
          </button>
          {projects.length > 0 && (
            <div className="project-nav-tree">
              {projects.map((project) => {
                const isExpanded = expandedProjects.has(project.path) || selectedProjectPath === project.path;
                const projectServers = getProjectServers(project.name);
                return (
                  <div className="project-nav-group" key={project.path}>
                    <button
                      className="project-nav-root"
                      data-active={tab === "projects" && selectedProjectPath === project.path}
                      onClick={() => selectProject(project.path)}
                    >
                      <span className="material-symbols-outlined project-nav-root__icon">folder</span>
                      <span className="project-nav-root__name">{project.name}</span>
                      <span
                        className="material-symbols-outlined project-nav-root__chevron"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProject(project.path);
                        }}
                      >
                        {isExpanded ? "expand_more" : "chevron_right"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="project-nav-children">
                        {projectServers.length > 0 ? (
                          projectServers.map((server) => (
                            <button
                              className="project-nav-child"
                              key={server.name}
                              onClick={() => {
                                setSelectedProjectPath(project.path);
                                setSelectedServer(server.name);
                              }}
                            >
                              <span className="material-symbols-outlined">dns</span>
                              <span>{server.name.slice(project.name.length + 1)}</span>
                            </button>
                          ))
                        ) : (
                          <span className="project-nav-empty">No local MCPs</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            className="nav-button"
            data-active={tab === "plugins"}
            onClick={() => void handleTabChange("plugins")}
          >
            <span className="material-symbols-outlined">extension</span>
            <span className="nav-button__label">Plugins</span>
          </button>
          <div className="nav-spacer" />
          <button
            className="nav-button"
            data-active={tab === "settings"}
            onClick={() => void handleTabChange("settings")}
          >
            <span className="material-symbols-outlined">settings</span>
            <span className="nav-button__label">Settings</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="main-content-inner">
          {activeServer ? (
            <ServerDetail
              server={activeServer}
              onBack={() => setSelectedServer(null)}
              onRefresh={refresh}
            />
          ) : (
            <>
              {tab === "servers" && (
                <>
                  <div className="page-header page-header--split">
                    <h1 className="page-title">My Servers</h1>
                    {report.daemon?.running && typeof report.totalGlobalTokens === "number" && (
                      <div className="token-badge-total" title="Context window tokens consumed by globally enabled MCP servers">
                        <span className="material-symbols-outlined font-icon-sm">analytics</span>
                        <span>{formatTokenApprox(report.totalGlobalTokens)} Global Tokens Active</span>
                      </div>
                    )}
                  </div>
                  {report.daemon?.running && typeof report.totalGlobalTokens === "number" && (
                    <ContextBudgetCard totalTokens={report.totalGlobalTokens} />
                  )}
                  <div className="servers-controls-container">
                    <CliCommandInput onServerAdded={refresh} />
                  </div>
                  <div className="server-grid">
                    {report.servers.map((server) => (
                      <ServerCard
                        key={server.name}
                        name={server.name}
                        enabled={server.enabled}
                        transport={server.transport}
                        target={server.target}
                        authConfigured={server.authBindings.length > 0}
                        isOAuth={server.authBindings.some((b) => b.value.startsWith("oauth://"))}
                        syncedCount={server.clients.filter((c) => c.managed && c.status === "SYNCED").length}
                        errorCount={server.clients.filter((c) => c.managed && c.status === "ERROR").length}
                        tokenCount={server.tokenCount}
                        onRefresh={refresh}
                        onClick={() => setSelectedServer(server.name)}
                        onAuthClick={() => setPendingAuth({
                          serverName: server.name,
                          oauthLikely: server.authBindings.some((b) => b.value.startsWith("oauth://"))
                        })}
                      />
                    ))}
                  </div>
                </>
              )}

              {tab === "projects" && (
                <>
                  <div className="page-header">
                    <h1 className="page-title">Projects</h1>
                  </div>
                  <ProjectsTab
                    status={report}
                    onRefresh={refresh}
                    selectedProjectPath={selectedProjectPath}
                    onSelectedProjectPathChange={setSelectedProjectPath}
                  />
                </>
              )}

              {tab === "plugins" && (
                <PluginsTab />
              )}

              {tab === "settings" && (
                <>
                  <div className="page-header">
                    <h1 className="page-title">Settings</h1>
                  </div>
                  <SettingsPanel />
                </>
              )}
            </>
          )}
        </div>
      </main>

      {pendingAuth && (
        <AuthModal
          serverName={pendingAuth.serverName}
          oauthLikely={pendingAuth.oauthLikely}
          onClose={() => {
            void window.mcpx.dismissAuth?.(pendingAuth.serverName);
            setPendingAuth(null);
          }}
          onConfigured={() => { setPendingAuth(null); refresh(); }}
        />
      )}
    </div>
  );
}
