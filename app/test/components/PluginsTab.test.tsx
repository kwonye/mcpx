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
    update: vi.fn().mockResolvedValue({})
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

    expect(await screen.findByText("Test Plugin")).toBeDefined();
    expect(screen.getByText("v1.0.0")).toBeDefined();
    expect(screen.getByText("github:acme/test-plugin")).toBeDefined();
  });

  it("surfaces a rejected toggle action's error message via the feedback element", async () => {
    mockMcpx.plugins.disable.mockRejectedValueOnce(new Error("toggle failed: locked"));
    render(<PluginsTab />);

    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);

    const message = await screen.findByText("toggle failed: locked");
    expect(message.className).toContain("feedback-message");
    expect(message.className).toContain("error");
  });

  it("shows an error from a rejected loadPlugins while the list stays empty", async () => {
    mockMcpx.plugins.list.mockRejectedValueOnce(new Error("network unreachable"));
    render(<PluginsTab />);

    const message = await screen.findByText("network unreachable");
    expect(message.className).toContain("feedback-message");
    expect(message.className).toContain("error");
    expect(screen.getByText("No plugins installed.")).toBeDefined();
    expect(screen.queryByText("Test Plugin")).toBeNull();
  });
});
