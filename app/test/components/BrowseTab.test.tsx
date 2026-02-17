import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowseTab } from "../../src/renderer/components/BrowseTab";

const mockMcpx = {
  getStatus: vi.fn(),
  getServers: vi.fn(),
  addServer: vi.fn(),
  removeServer: vi.fn(),
  syncAll: vi.fn(),
  daemonStart: vi.fn(),
  daemonStop: vi.fn(),
  daemonRestart: vi.fn(),
  registryList: vi.fn().mockResolvedValue({
    servers: [
      { server: { name: "io.github.example/brave-search", title: "Brave Search", description: "Search with Brave" } },
      { server: { name: "io.github.example/github", title: "GitHub MCP", description: "GitHub integration" } }
    ],
    metadata: { count: 2, nextCursor: null }
  }),
  registryGet: vi.fn(),
  registryPrepareAdd: vi.fn().mockResolvedValue({
    shortName: "brave-search",
    requiredInputs: [{ name: "BRAVE_API_KEY", description: "Brave API key", isSecret: true, kind: "env" }]
  }),
  registryConfirmAdd: vi.fn().mockResolvedValue({ added: "brave-search" }),
  openDashboard: vi.fn()
};

beforeAll(() => {
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("BrowseTab", () => {
  it("renders search input", () => {
    render(<BrowseTab onServerAdded={() => {}} />);
    expect(screen.getByPlaceholderText("Search MCP servers...")).toBeDefined();
  });

  it("shows registry results after search", async () => {
    render(<BrowseTab onServerAdded={() => {}} />);
    const searchButton = screen.getByText("Search");
    fireEvent.click(searchButton);
    expect(await screen.findByText("Brave Search")).toBeDefined();
    expect(await screen.findByText("GitHub MCP")).toBeDefined();
  });

  it("shows add form with required inputs when adding server", async () => {
    render(<BrowseTab onServerAdded={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    const addButtons = await screen.findAllByText("Add");
    fireEvent.click(addButtons[0]);
    expect(await screen.findByText("Configure brave-search")).toBeDefined();
    expect(screen.getByLabelText("BRAVE_API_KEY")).toBeDefined();
  });
});
