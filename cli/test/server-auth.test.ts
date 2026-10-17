import { describe, expect, it } from "bun:test";
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

  it("prefixes Bearer for Authorization unless value is already schemed or not token68", () => {
    const target = { kind: "header" as const, key: "Authorization" };
    // Bare token68 → Bearer prefix
    expect(maybePrefixBearer(target, "abc123", false)).toBe("Bearer abc123");
    expect(maybePrefixBearer(target, "dGhpcyBpcyBhIHRva2Vu", false)).toBe("Bearer dGhpcyBpcyBhIHRva2Vu");
    // Already has scheme → untouched
    expect(maybePrefixBearer(target, "Bearer abc123", false)).toBe("Bearer abc123");
    expect(maybePrefixBearer(target, "Basic abc123", false)).toBe("Basic abc123");
    // Raw bypass
    expect(maybePrefixBearer(target, "abc123", true)).toBe("abc123");
    // Contains colon, comma, semicolon → not token68 → pass through
    expect(maybePrefixBearer(target, "abc:def", false)).toBe("abc:def");
    expect(maybePrefixBearer(target, "key=value;more", false)).toBe("key=value;more");
    // Custom scheme → already schemed → untouched
    expect(maybePrefixBearer(target, "Token abc123", false)).toBe("Token abc123");
  });

  it("derives stable secret names and parses secret refs", () => {
    const name = defaultAuthSecretName("next-devtools", { kind: "env", key: "NEXT DEVTOOLS TOKEN" });
    expect(name).toBe("auth_next-devtools_env_next_devtools_token");
    expect(secretRefName(`secret://${name}`)).toBe(name);
  });
});
