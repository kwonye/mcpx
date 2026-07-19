import { describe, expect, it } from "bun:test";
import { UpstreamError, SecretNotFoundError, classifyUpstreamError } from "../src/core/errors.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("upstream error taxonomy", () => {
  it("classifies SecretNotFoundError as secret_missing", () => {
    const err = new SecretNotFoundError("my_secret");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("secret_missing");
    expect(classified.message).toContain("mcpx secret set");
  });

  it("classifies 401 as auth_required", () => {
    const err = new StreamableHTTPError(401, "Unauthorized");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("auth_required");
    expect(classified.status).toBe(401);
  });

  it("classifies 403 as auth_required", () => {
    const err = new StreamableHTTPError(403, "Forbidden");
    const classified = classifyUpstreamError("test-server", err, 'Bearer realm="test"');
    expect(classified.code).toBe("auth_required");
    expect(classified.wwwAuthenticate).toBe('Bearer realm="test"');
  });

  it("classifies timeout messages as timeout", () => {
    const err = new Error("Upstream test-server timed out after 60000ms for method tools/list.");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("timeout");
  });

  it("classifies ECONNREFUSED as unreachable", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:37373");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies ENOTFOUND as unreachable", () => {
    const err = new Error("getaddrinfo ENOTFOUND nonexistent.example.com");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies fetch failed as unreachable", () => {
    const err = new Error("fetch failed: reason");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies Bun connection-refused errors as unreachable", () => {
    // Actual shape thrown by Bun's native fetch for a refused connection (or DNS failure)
    const err = Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), {
      code: "ConnectionRefused"
    });
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies a ConnectionRefused error code as unreachable regardless of message", () => {
    const err = Object.assign(new Error("some other wording"), { code: "ConnectionRefused" });
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies a Bun unable-to-connect message as unreachable without an error code", () => {
    const err = new Error("Unable to connect. Is the computer able to access the url?");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("unreachable");
  });

  it("classifies unknown errors as upstream_error", () => {
    const err = new Error("Internal server error");
    const classified = classifyUpstreamError("test-server", err);
    expect(classified.code).toBe("upstream_error");
  });

  it("preserves already-classified UpstreamError", () => {
    const original = new UpstreamError("test", "auth_expired", "Refresh token invalid");
    const classified = classifyUpstreamError("test", original);
    expect(classified).toBe(original);
  });

  it("includes upstream name in the error", () => {
    const err = new Error("something went wrong");
    const classified = classifyUpstreamError("my-server", err);
    expect(classified.upstream).toBe("my-server");
  });
});
