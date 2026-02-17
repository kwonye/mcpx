import { describe, expect, it } from "vitest";
import {
  applyAuthReference,
  defaultAuthSecretName,
  maybePrefixBearer,
  removeAuthReference,
  resolveAuthTarget,
  secretRefName,
  toSecretRef
} from "../src/core/server-auth.js";
import type { HttpServerSpec, StdioServerSpec } from "../src/types.js";

describe("server auth helpers", () => {
  it("resolves HTTP auth target to Authorization by default", () => {
    const spec: HttpServerSpec = {
      transport: "http",
      url: "https://example.com/mcp"
    };

    const target = resolveAuthTarget(spec);
    expect(target).toEqual({ kind: "header", key: "Authorization" });
  });

  it("requires --env for stdio auth target", () => {
    const spec: StdioServerSpec = {
      transport: "stdio",
      command: "npx"
    };

    expect(() => resolveAuthTarget(spec)).toThrow("Env var name");
  });

  it("applies and removes HTTP auth refs", () => {
    const spec: HttpServerSpec = {
      transport: "http",
      url: "https://example.com/mcp"
    };

    const target = resolveAuthTarget(spec, "Authorization");
    const ref = toSecretRef("auth_example_header_authorization");
    applyAuthReference(spec, target, ref);
    expect(spec.headers?.Authorization).toBe(ref);

    const removed = removeAuthReference(spec, target);
    expect(removed).toBe(ref);
    expect(spec.headers).toBeUndefined();
  });

  it("prefixes Bearer for Authorization unless value is already schemed", () => {
    const target = { kind: "header" as const, key: "Authorization" };
    expect(maybePrefixBearer(target, "abc123", false)).toBe("Bearer abc123");
    expect(maybePrefixBearer(target, "Bearer abc123", false)).toBe("Bearer abc123");
    expect(maybePrefixBearer(target, "abc123", true)).toBe("abc123");
  });

  it("derives stable secret names and parses secret refs", () => {
    const name = defaultAuthSecretName("next-devtools", { kind: "env", key: "NEXT DEVTOOLS TOKEN" });
    expect(name).toBe("auth_next-devtools_env_next_devtools_token");
    expect(secretRefName(`secret://${name}`)).toBe(name);
  });
});
