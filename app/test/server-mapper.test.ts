import { describe, expect, it } from "vitest";
import { mapServerToSpec, selectBestPackage, extractRequiredInputs } from "../src/main/server-mapper";

describe("selectBestPackage", () => {
  it("prefers npm stdio over remote http", () => {
    const result = selectBestPackage(
      [{ registryType: "npm", identifier: "@test/pkg", transport: { type: "stdio" } }],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("package");
    expect(result.package?.registryType).toBe("npm");
  });

  it("prefers pypi over remote http", () => {
    const result = selectBestPackage(
      [{ registryType: "pypi", identifier: "test-pkg", transport: { type: "stdio" } }],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("package");
  });

  it("falls back to remote when no packages", () => {
    const result = selectBestPackage(
      [],
      [{ type: "streamable-http", url: "https://example.com/mcp" }]
    );
    expect(result.kind).toBe("remote");
  });

  it("throws when no packages or remotes", () => {
    expect(() => selectBestPackage([], [])).toThrow("Server has no packages or remotes");
  });
});

describe("extractRequiredInputs", () => {
  it("returns empty for server with no required env vars or args", () => {
    const inputs = extractRequiredInputs({
      kind: "package",
      package: { registryType: "npm", identifier: "@test/pkg", transport: { type: "stdio" } }
    });
    expect(inputs).toEqual([]);
  });

  it("extracts required secret env vars", () => {
    const inputs = extractRequiredInputs({
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@test/pkg",
        transport: { type: "stdio" },
        environmentVariables: [
          { name: "API_KEY", description: "Your API key", isRequired: true, isSecret: true },
          { name: "LOG_LEVEL", description: "Log level", default: "info" }
        ]
      }
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      name: "API_KEY",
      description: "Your API key",
      isSecret: true,
      kind: "env"
    });
  });

  it("extracts required headers from remote", () => {
    const inputs = extractRequiredInputs({
      kind: "remote",
      remote: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: [
          { name: "Authorization", description: "Bearer token", isRequired: true, isSecret: true }
        ]
      }
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0].kind).toBe("header");
  });
});

describe("mapServerToSpec", () => {
  it("maps npm package to stdio spec", () => {
    const spec = mapServerToSpec("test-server", {
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@test/server-pkg",
        version: "1.0.0",
        transport: { type: "stdio" }
      }
    }, {});
    expect(spec.transport).toBe("stdio");
    expect((spec as { command: string }).command).toBe("npx");
    expect((spec as { args: string[] }).args).toContain("@test/server-pkg@1.0.0");
  });

  it("maps pypi package to stdio spec with uvx", () => {
    const spec = mapServerToSpec("weather", {
      kind: "package",
      package: {
        registryType: "pypi",
        identifier: "weather-mcp",
        version: "0.5.0",
        transport: { type: "stdio" }
      }
    }, {});
    expect((spec as { command: string }).command).toBe("uvx");
    expect((spec as { args: string[] }).args).toContain("weather-mcp@0.5.0");
  });

  it("maps remote to http spec", () => {
    const spec = mapServerToSpec("cloud", {
      kind: "remote",
      remote: { type: "streamable-http", url: "https://cloud.example.com/mcp" }
    }, {});
    expect(spec.transport).toBe("http");
    expect((spec as { url: string }).url).toBe("https://cloud.example.com/mcp");
  });

  it("includes env vars with secret refs", () => {
    const spec = mapServerToSpec("brave", {
      kind: "package",
      package: {
        registryType: "npm",
        identifier: "@mcp/brave-search",
        version: "1.0.0",
        transport: { type: "stdio" },
        environmentVariables: [
          { name: "BRAVE_API_KEY", isRequired: true, isSecret: true }
        ]
      }
    }, { BRAVE_API_KEY: "secret://brave_api_key" });
    expect((spec as { env: Record<string, string> }).env?.BRAVE_API_KEY).toBe("secret://brave_api_key");
  });
});
