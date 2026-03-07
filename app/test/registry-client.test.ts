import { describe, expect, it, vi } from "vitest";
import { fetchRegistryServers, fetchServerDetail } from "../src/main/registry-client";
import { matchSearchQuery, filterServersByQuery, sortServersByRelevance, calculateRelevanceScore } from "../src/main/search-utils";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("registry client", () => {
  it("fetches paginated server list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        servers: [
          { server: { name: "io.github.example/test", description: "Test server", version: "1.0.0" } }
        ],
        metadata: { count: 1, nextCursor: null }
      })
    });

    const result = await fetchRegistryServers();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].server.name).toBe("io.github.example/test");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v0.1/servers"),
      expect.any(Object)
    );
  });

  it("passes cursor for pagination", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [], metadata: { count: 0, nextCursor: null } })
    });

    await fetchRegistryServers("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("cursor=abc123"),
      expect.any(Object)
    );
  });

  it("passes query for search", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [], metadata: { count: 0, nextCursor: null } })
    });

    await fetchRegistryServers(undefined, "brave");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("search=brave"),
      expect.any(Object)
    );
  });

  it("fetches with custom limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ servers: [], metadata: { count: 0, nextCursor: null } })
    });

    await fetchRegistryServers(undefined, undefined, 200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=200"),
      expect.any(Object)
    );
  });

  it("filters servers client-side when query is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        servers: [
          { server: { name: "io.github/test", description: "Brave search server", version: "1.0.0" } },
          { server: { name: "io.github/other", description: "Something else", version: "1.0.0" } }
        ],
        metadata: { count: 2, nextCursor: null }
      })
    });

    const result = await fetchRegistryServers(undefined, "brave");
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].server.description).toContain("Brave");
  });

  it("fetches latest version detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        server: {
          name: "io.github.example/test",
          description: "Test",
          version: "1.0.0",
          packages: [{
            registryType: "npm",
            identifier: "@example/test",
            version: "1.0.0",
            transport: { type: "stdio" }
          }]
        }
      })
    });

    const result = await fetchServerDetail("io.github.example/test");
    expect(result.server.packages).toHaveLength(1);
    expect(result.server.packages![0].registryType).toBe("npm");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404
    });

    await expect(fetchRegistryServers()).rejects.toThrow("Registry API error: 404");
  });
});

describe("search utils", () => {
  const mockServer = {
    server: {
      name: "io.github.example/brave-search",
      title: "Brave Search MCP",
      description: "Search the web with Brave Search API",
      version: "1.0.0",
      repository: {
        url: "https://github.com/brave/brave-search-mcp-server",
        subfolder: "packages/search"
      },
      packages: [
        {
          registryType: "npm",
          identifier: "@brave/search-mcp",
          transport: { type: "stdio" }
        }
      ]
    },
    _meta: {}
  };

  describe("matchSearchQuery", () => {
    it("matches against name field", () => {
      expect(matchSearchQuery(mockServer, "brave")).toBe(true);
      expect(matchSearchQuery(mockServer, "search")).toBe(true);
    });

    it("matches against title field", () => {
      expect(matchSearchQuery(mockServer, "Brave")).toBe(true);
      expect(matchSearchQuery(mockServer, "MCP")).toBe(true);
    });

    it("matches against description field", () => {
      expect(matchSearchQuery(mockServer, "web")).toBe(true);
      expect(matchSearchQuery(mockServer, "API")).toBe(true);
    });

    it("matches against repository URL", () => {
      expect(matchSearchQuery(mockServer, "github")).toBe(true);
      expect(matchSearchQuery(mockServer, "brave-search-mcp-server")).toBe(true);
    });

    it("matches against package identifier", () => {
      expect(matchSearchQuery(mockServer, "@brave/search-mcp")).toBe(true);
    });

    it("returns false for non-matching queries", () => {
      expect(matchSearchQuery(mockServer, "xyz123nonexistent")).toBe(false);
    });

    it("is case-insensitive by default", () => {
      expect(matchSearchQuery(mockServer, "BRAVE")).toBe(true);
      expect(matchSearchQuery(mockServer, "BrAvE")).toBe(true);
    });

    it("respects case-sensitive option", () => {
      expect(matchSearchQuery(mockServer, "BRAVE", { caseSensitive: true })).toBe(false);
      expect(matchSearchQuery(mockServer, "brave", { caseSensitive: true })).toBe(true);
    });

    it("can search specific fields only", () => {
      expect(matchSearchQuery(mockServer, "web", { fields: ["name"] })).toBe(false);
      expect(matchSearchQuery(mockServer, "web", { fields: ["description"] })).toBe(true);
    });
  });

  describe("filterServersByQuery", () => {
    const servers = [
      { server: { name: "io.github/brave", description: "Brave search", version: "1.0.0" } },
      { server: { name: "io.github/google", description: "Google search", version: "1.0.0" } },
      { server: { name: "io.github/database", description: "PostgreSQL client", version: "1.0.0" } }
    ];

    it("returns all servers when query is empty", () => {
      expect(filterServersByQuery(servers, "")).toEqual(servers);
      expect(filterServersByQuery(servers, "   ")).toEqual(servers);
    });

    it("filters servers by query", () => {
      const filtered = filterServersByQuery(servers, "brave");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].server.name).toBe("io.github/brave");
    });

    it("matches multiple servers", () => {
      const filtered = filterServersByQuery(servers, "search");
      expect(filtered).toHaveLength(2);
    });
  });

  describe("sortServersByRelevance", () => {
    const servers = [
      { server: { name: "io.github/search", description: "Generic search tool", version: "1.0.0" } },
      { server: { name: "io.github/brave", title: "Brave Search", description: "Search with Brave", version: "1.0.0" } },
      { server: { name: "io.github/other", description: "Something else", version: "1.0.0" } }
    ];

    it("sorts by relevance score", () => {
      const sorted = sortServersByRelevance(servers, "brave");
      expect(sorted[0].server.name).toBe("io.github/brave");
    });

    it("returns original order when no query", () => {
      const sorted = sortServersByRelevance(servers, "");
      expect(sorted).toEqual(servers);
    });
  });

  describe("calculateRelevanceScore", () => {
    it("scores exact name matches highest", () => {
      const exactMatch = { server: { name: "brave", description: "test", version: "1.0.0" } };
      const partialMatch = { server: { name: "brave-search", description: "test", version: "1.0.0" } };
      
      const exactScore = calculateRelevanceScore(exactMatch, "brave");
      const partialScore = calculateRelevanceScore(partialMatch, "brave");
      
      expect(exactScore).toBeGreaterThan(partialScore);
    });

    it("scores title matches", () => {
      const server = { server: { name: "io.github/test", title: "Brave Search", description: "test", version: "1.0.0" } };
      const score = calculateRelevanceScore(server, "brave");
      expect(score).toBeGreaterThan(0);
    });

    it("scores description matches", () => {
      const server = { server: { name: "io.github/test", description: "Search the web with Brave", version: "1.0.0" } };
      const score = calculateRelevanceScore(server, "brave");
      expect(score).toBeGreaterThan(0);
    });
  });
});
