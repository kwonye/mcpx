import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PluginsTab } from "../../src/renderer/components/PluginsTab";

const basePlugin = {
  id: "plugin-1",
  name: "Test Plugin",
  version: "1.0.0",
  source: "github:acme/test-plugin",
  enabled: true,
  status: "healthy",
  components: { mcpServers: false, skills: false, hooks: false, agents: false, commands: false },
  discovered: { mcpServers: [], skills: [], hooks: [], agents: [], commands: [] },
  serverNames: [],
  approvals: {}
};

const mockMcpx = {
  plugins: {
    list: vi.fn().mockResolvedValue([basePlugin]),
    install: vi.fn().mockResolvedValue({}),
    enable: vi.fn().mockResolvedValue({}),
    disable: vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({}),
    uninstall: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    marketplaces: {
      list: vi.fn().mockResolvedValue([
        { name: "claude-plugins-official", displayName: "Claude official", source: "anthropics/claude-plugins-official", builtIn: true, autoUpdate: true, addedAt: "1970-01-01T00:00:00.000Z", status: "ready" }
      ]),
      browse: vi.fn().mockResolvedValue([
        { id: "reviewer@claude-plugins-official", name: "reviewer", displayName: "Reviewer", marketplace: "claude-plugins-official", description: "Review code", tags: [], source: "./reviewer", supportedCapabilities: ["skills"], unsupportedCapabilities: [], compatible: true, installed: false }
      ]),
      inspectPlugin: vi.fn().mockResolvedValue({}),
      installPlugin: vi.fn().mockResolvedValue({}),
      add: vi.fn().mockResolvedValue({}),
      refresh: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue({}),
      setAutoUpdate: vi.fn().mockResolvedValue({})
    }
  },
  skills: {
    list: vi.fn().mockResolvedValue([])
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("PluginsTab", () => {
  it("renders a list of plugins from the stub", async () => {
    render(<PluginsTab />);
    fireEvent.click(await screen.findByRole("tab", { name: /Installed/ }));

    expect(await screen.findByText("Test Plugin")).toBeDefined();
    expect(screen.getByText("v1.0.0")).toBeDefined();
    expect(screen.getByText("github:acme/test-plugin")).toBeDefined();
  });

  it("surfaces a rejected toggle action's error message via the feedback element", async () => {
    mockMcpx.plugins.disable.mockRejectedValueOnce(new Error("toggle failed: locked"));
    render(<PluginsTab />);
    fireEvent.click(await screen.findByRole("tab", { name: /Installed/ }));

    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);

    const message = await screen.findByText("toggle failed: locked");
    expect(message.className).toContain("feedback-message");
    expect(message.className).toContain("error");
  });

  it("shows an error from a rejected loadPlugins while the list stays empty", async () => {
    mockMcpx.plugins.list
      .mockRejectedValueOnce(new Error("network unreachable"))
      .mockRejectedValueOnce(new Error("network unreachable"));
    render(<PluginsTab />);
    fireEvent.click(await screen.findByRole("tab", { name: /Installed/ }));

    const message = await screen.findByText("network unreachable");
    expect(message.className).toContain("feedback-message");
    expect(message.className).toContain("error");
    expect(screen.getByText("No plugins installed.")).toBeDefined();
    expect(screen.queryByText("Test Plugin")).toBeNull();
  });

  it("browses marketplace listings and exposes compatibility", async () => {
    render(<PluginsTab />);
    expect(await screen.findByText("Reviewer")).toBeDefined();
    expect(screen.getByText("Compatible")).toBeDefined();
    expect(screen.getAllByText("Claude official").length).toBeGreaterThan(0);
  });

  it("shows the two default marketplace controls", async () => {
    render(<PluginsTab />);
    fireEvent.click(await screen.findByRole("tab", { name: "Marketplaces" }));
    expect(await screen.findByText("Claude official")).toBeDefined();
    expect(screen.getByText("Default")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("refreshes marketplace installed state when returning to Discover", async () => {
    mockMcpx.plugins.marketplaces.browse
      .mockResolvedValueOnce([{
        id: "reviewer@claude-plugins-official",
        name: "reviewer",
        displayName: "Reviewer",
        marketplace: "claude-plugins-official",
        description: "Review code",
        tags: [],
        source: "./reviewer",
        supportedCapabilities: ["skills"],
        unsupportedCapabilities: [],
        compatible: true,
        installed: true
      }])
      .mockResolvedValueOnce([{
        id: "reviewer@claude-plugins-official",
        name: "reviewer",
        displayName: "Reviewer",
        marketplace: "claude-plugins-official",
        description: "Review code",
        tags: [],
        source: "./reviewer",
        supportedCapabilities: ["skills"],
        unsupportedCapabilities: [],
        compatible: true,
        installed: false
      }]);

    render(<PluginsTab />);
    expect(await screen.findByText("Installed")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: /Installed/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Discover" }));

    await screen.findByText("Reviewer");
    expect(mockMcpx.plugins.marketplaces.browse).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Installed")).toBeNull();
  });
});
