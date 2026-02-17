import { describe, expect, it, vi } from "vitest";
import { fetchRegistryServers, fetchServerDetail } from "../src/main/registry-client";

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
      expect.stringContaining("q=brave"),
      expect.any(Object)
    );
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
