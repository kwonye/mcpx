import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowseTab } from "../../src/renderer/components/BrowseTab";

const defaultRegistryResponse = {
  servers: [
    { server: { name: "io.github.example/brave-search", title: "Brave Search", description: "Search with Brave" } },
    { server: { name: "io.github.example/github", title: "GitHub MCP", description: "GitHub integration" } }
  ],
  metadata: { count: 2, nextCursor: null }
};

const mockMcpx = {
  getStatus: vi.fn(),
  getServers: vi.fn(),
  addServer: vi.fn(),
  removeServer: vi.fn(),
  syncAll: vi.fn(),
  daemonStart: vi.fn(),
  daemonStop: vi.fn(),
  daemonRestart: vi.fn(),
  registryList: vi.fn().mockResolvedValue(defaultRegistryResponse),
  registryGet: vi.fn(),
  registryPrepareAdd: vi.fn().mockResolvedValue({
    shortName: "brave-search",
    requiredInputs: [{ name: "BRAVE_API_KEY", description: "Brave API key", isSecret: true, kind: "env" }]
  }),
  registryConfirmAdd: vi.fn().mockResolvedValue({ added: "brave-search" }),
  openDashboard: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMcpx.registryList.mockResolvedValue(defaultRegistryResponse);
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("BrowseTab", () => {
  it("renders search input", async () => {
    render(<BrowseTab onServerAdded={() => {}} />);
    expect(screen.getByPlaceholderText("Search for tools, databases, APIs...")).toBeDefined();
    await screen.findByText("Brave Search");
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
    const addButtons = await screen.findAllByText("Add Server");
    fireEvent.click(addButtons[0]);
    expect(await screen.findByText("Configure brave-search")).toBeDefined();
    expect(screen.getByLabelText(/^BRAVE_API_KEY/)).toBeDefined();
  });

  it("passes trimmed search query to registry list", async () => {
    render(<BrowseTab onServerAdded={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search for tools, databases, APIs..."), {
      target: { value: "  context  " }
    });
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() => {
      expect(mockMcpx.registryList).toHaveBeenCalledWith(undefined, "context");
    });
  });

  it("keeps latest search results when earlier requests resolve later", async () => {
    const initialResolvers: Array<(value: typeof defaultRegistryResponse) => void> = [];
    let searchResolver: ((value: typeof defaultRegistryResponse) => void) | undefined;

    mockMcpx.registryList.mockImplementation((_cursor?: string, query?: string) => {
      return new Promise((resolve) => {
        if (query === "context") {
          searchResolver = resolve as (value: typeof defaultRegistryResponse) => void;
          return;
        }
        initialResolvers.push(resolve as (value: typeof defaultRegistryResponse) => void);
      });
    });

    render(<BrowseTab onServerAdded={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search for tools, databases, APIs..."), {
      target: { value: "context" }
    });
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() => {
      expect(searchResolver).toBeDefined();
    });

    searchResolver?.({
      servers: [
        { server: { name: "ai.autoblocks/contextlayer-mcp", title: "Context Layer", description: "Context tools" } }
      ],
      metadata: { count: 1, nextCursor: null }
    });
    expect(await screen.findByText("Context Layer")).toBeDefined();

    for (const resolve of initialResolvers) {
      resolve(defaultRegistryResponse);
    }

    await waitFor(() => {
      expect(screen.queryByText("Brave Search")).toBeNull();
    });
  });

  it("shows empty-state message when search has no matches", async () => {
    mockMcpx.registryList.mockImplementation(async (_cursor?: string, query?: string) => {
      if (query === "nomatch") {
        return { servers: [], metadata: { count: 0, nextCursor: null } };
      }
      return defaultRegistryResponse;
    });

    render(<BrowseTab onServerAdded={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search for tools, databases, APIs..."), {
      target: { value: "nomatch" }
    });
    fireEvent.click(screen.getByText("Search"));

    expect(await screen.findByText('No servers found for "nomatch". Try another search.')).toBeDefined();
  });
});
