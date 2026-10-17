import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { ProjectsTab } from "../../src/renderer/components/ProjectsTab";

const project = {
  name: "demo-app",
  path: "/Users/dev/demo-app",
  disabledServers: ["server-b"]
};

const servers = [
  { name: "server-a", enabled: true, transport: "stdio", target: "npx server-a", clients: [] },
  { name: "server-b", enabled: true, transport: "http", target: "https://example.com/mcp", clients: [] }
];

// Globally enabled, no per-project override -> effective state mirrors the global flag.
const pluginNoOverride = {
  id: "plugin-alpha",
  name: "Alpha Plugin",
  version: "1.0.0",
  source: "github:acme/alpha-plugin",
  enabled: true,
  status: "healthy",
  components: { mcpServers: false, skills: false, hooks: false, agents: false, commands: false },
  discovered: { mcpServers: [], skills: [], hooks: [], agents: [], commands: [] },
  serverNames: [],
  approvals: {}
};

// Globally enabled, but overridden off for `project.path` specifically.
const pluginWithOverride = {
  id: "plugin-beta",
  name: "Beta Plugin",
  version: "2.0.0",
  source: "github:acme/beta-plugin",
  enabled: true,
  status: "healthy",
  components: { mcpServers: false, skills: false, hooks: false, agents: false, commands: false },
  discovered: { mcpServers: [], skills: [], hooks: [], agents: [], commands: [] },
  serverNames: [],
  approvals: {},
  projectOverrides: {
    [project.path]: { enabled: false }
  }
};

const mockMcpx = {
  plugins: {
    list: vi.fn(),
    setProjectOverride: vi.fn(),
    resetProjectOverride: vi.fn()
  },
  setProjectServerEnabled: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMcpx.plugins.list.mockResolvedValue([]);
  mockMcpx.plugins.setProjectOverride.mockResolvedValue(undefined);
  mockMcpx.plugins.resetProjectOverride.mockResolvedValue(undefined);
  mockMcpx.setProjectServerEnabled.mockResolvedValue(undefined);
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("ProjectsTab", () => {
  it("reflects registered projects from the status prop rather than fetching its own list", async () => {
    const { unmount } = render(
      <ProjectsTab
        status={{ servers: [] }}
        onRefresh={vi.fn()}
        selectedProjectPath={null}
        onSelectedProjectPathChange={vi.fn()}
      />
    );
    expect(await screen.findByText("No Projects Registered")).toBeDefined();
    unmount();

    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={null}
        onSelectedProjectPathChange={vi.fn()}
      />
    );
    expect(await screen.findByText("Select a Project")).toBeDefined();
  });

  it("shows the selected project's detail with its path and MCP Servers section", async () => {
    render(
      <ProjectsTab
        status={{ servers, projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { level: 2, name: project.name })).toBeDefined();
    expect(screen.getByText(project.path)).toBeDefined();
    expect(screen.getByText("MCP Servers")).toBeDefined();
  });

  it("toggles a server's effective state for the selected project via its path", async () => {
    render(
      <ProjectsTab
        status={{ servers, projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    const row = (await screen.findByText("server-b")).closest(".project-mcp-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));

    // server-b is globally enabled but listed in this project's disabledServers, so its
    // effective state is off; toggling should flip the per-project override back on.
    expect(mockMcpx.setProjectServerEnabled).toHaveBeenCalledWith(project.path, "server-b", true);
  });

  it("renders installed plugins with their effective per-project state", async () => {
    mockMcpx.plugins.list.mockResolvedValue([pluginNoOverride, pluginWithOverride]);

    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    const alphaRow = (await screen.findByText("Alpha Plugin")).closest(".project-mcp-row") as HTMLElement;
    expect(within(alphaRow).getByText("Enabled")).toBeDefined();

    const betaRow = screen.getByText("Beta Plugin").closest(".project-mcp-row") as HTMLElement;
    expect(within(betaRow).getByText("Disabled")).toBeDefined();
    expect(within(betaRow).getByRole("button", { name: "Use global" })).toBeDefined();
  });

  it("toggles a plugin's per-project override and refetches the plugin list", async () => {
    mockMcpx.plugins.list.mockResolvedValue([pluginNoOverride]);

    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    const row = (await screen.findByText("Alpha Plugin")).closest(".project-mcp-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox"));

    await waitFor(() => {
      expect(mockMcpx.plugins.setProjectOverride).toHaveBeenCalledWith("plugin-alpha", project.path, { enabled: false });
      expect(mockMcpx.plugins.list).toHaveBeenCalledTimes(2);
    });
  });

  it("resets a plugin override to inherit the global setting and refetches the plugin list", async () => {
    mockMcpx.plugins.list.mockResolvedValue([pluginWithOverride]);

    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    const row = (await screen.findByText("Beta Plugin")).closest(".project-mcp-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Use global" }));

    await waitFor(() => {
      expect(mockMcpx.plugins.resetProjectOverride).toHaveBeenCalledWith("plugin-beta", project.path);
      expect(mockMcpx.plugins.list).toHaveBeenCalledTimes(2);
    });
  });

  it("marks globally disabled plugins as off even if a project override enables them", async () => {
    mockMcpx.plugins.list.mockResolvedValue([{
      ...pluginWithOverride,
      enabled: false,
      projectOverrides: { [project.path]: { enabled: true } }
    }]);

    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    const row = (await screen.findByText("Beta Plugin")).closest(".project-mcp-row") as HTMLElement;
    expect(within(row).getByText("globally off")).toBeDefined();
    expect(within(row).getByText("Disabled")).toBeDefined();
    expect((within(row).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("shows an empty state when no plugins are installed", async () => {
    render(
      <ProjectsTab
        status={{ servers: [], projects: { [project.path]: project } }}
        onRefresh={vi.fn()}
        selectedProjectPath={project.path}
        onSelectedProjectPathChange={vi.fn()}
      />
    );

    expect(await screen.findByText("No plugins installed.")).toBeDefined();
  });
});
