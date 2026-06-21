import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServerCard } from "../../src/renderer/components/ServerCard";
import { describeTokenError } from "../../src/renderer/utils/tokenHelper";

const mockMcpx = {
  setServerEnabled: vi.fn().mockResolvedValue({}),
  startOauth: vi.fn().mockResolvedValue({})
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("ServerCard", () => {
  it("renders server name and transport", () => {
    render(
      <ServerCard
        name="vercel"
        enabled={true}
        transport="http"
        target="https://mcp.vercel.com"
        authConfigured={true}
        isOAuth={false}
        syncedCount={3}
        errorCount={0}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("vercel")).toBeDefined();
    expect(screen.getByText("public")).toBeDefined(); // the http icon
  });

  it("shows error indicator when errors exist", () => {
    render(
      <ServerCard
        name="broken"
        enabled={true}
        transport="stdio"
        target="npx broken-mcp"
        authConfigured={false}
        isOAuth={false}
        syncedCount={1}
        errorCount={2}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/2 Errors/i)).toBeDefined();
  });

  it("shows synced count", () => {
    render(
      <ServerCard
        name="test"
        enabled={true}
        transport="http"
        target="https://test.com/mcp"
        authConfigured={false}
        isOAuth={false}
        syncedCount={5}
        errorCount={0}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("5")).toBeDefined();
  });

  it("shows disabled state", () => {
    render(
      <ServerCard
        name="paused"
        enabled={false}
        transport="http"
        target="https://paused.example.com/mcp"
        authConfigured={false}
        isOAuth={false}
        syncedCount={3}
        errorCount={0}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("Disabled")).toBeDefined();
    expect(screen.getAllByText("Off")).toHaveLength(2);
  });

  it("toggles enabled state from the card", () => {
    render(
      <ServerCard
        name="vercel"
        enabled={true}
        transport="http"
        target="https://mcp.vercel.com"
        authConfigured={false}
        isOAuth={false}
        syncedCount={3}
        errorCount={0}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText(/Disable vercel/i));

    expect(mockMcpx.setServerEnabled).toHaveBeenCalledWith("vercel", false);
  });

  it("does not open the card when the toggle is clicked", () => {
    const onClick = vi.fn();
    render(
      <ServerCard
        name="vercel"
        enabled={true}
        transport="http"
        target="https://mcp.vercel.com"
        authConfigured={false}
        isOAuth={false}
        syncedCount={3}
        errorCount={0}
        onRefresh={() => {}}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByLabelText(/Disable vercel/i));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a re-auth button for OAuth server with token error", () => {
    render(
      <ServerCard
        name="stripe"
        enabled={true}
        transport="http"
        target="https://mcp.stripe.com/"
        authConfigured={true}
        isOAuth={true}
        syncedCount={3}
        errorCount={0}
        tokenCount={{ tools: 0, resources: 0, prompts: 0, total: 0, error: "Invalid refresh token" }}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/sign-in expired.*re-authenticate/i)).toBeDefined();
  });

  it("clicking the re-auth button on an OAuth server calls startOauth then onRefresh", async () => {
    const onRefresh = vi.fn();
    render(
      <ServerCard
        name="stripe"
        enabled={true}
        transport="http"
        target="https://mcp.stripe.com/"
        authConfigured={true}
        isOAuth={true}
        syncedCount={3}
        errorCount={0}
        tokenCount={{ tools: 0, resources: 0, prompts: 0, total: 0, error: "Invalid refresh token" }}
        onRefresh={onRefresh}
        onClick={() => {}}
      />
    );

    fireEvent.click(screen.getByText(/re-authenticate/i));

    await waitFor(() => {
      expect(mockMcpx.startOauth).toHaveBeenCalledWith("stripe");
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("clicking the re-auth button on a non-OAuth server calls onAuthClick, not startOauth", () => {
    const onAuthClick = vi.fn();
    render(
      <ServerCard
        name="custom"
        enabled={true}
        transport="http"
        target="https://custom.example.com/mcp"
        authConfigured={true}
        isOAuth={false}
        syncedCount={1}
        errorCount={0}
        tokenCount={{ tools: 0, resources: 0, prompts: 0, total: 0, error: "Unauthorized" }}
        onRefresh={() => {}}
        onClick={() => {}}
        onAuthClick={onAuthClick}
      />
    );

    fireEvent.click(screen.getByText(/re-authenticate/i));

    expect(onAuthClick).toHaveBeenCalled();
    expect(mockMcpx.startOauth).not.toHaveBeenCalled();
  });

  it("does not show a re-auth button when there is no token error", () => {
    render(
      <ServerCard
        name="healthy"
        enabled={true}
        transport="http"
        target="https://healthy.example.com/mcp"
        authConfigured={true}
        isOAuth={true}
        syncedCount={2}
        errorCount={0}
        tokenCount={{ tools: 1000, resources: 0, prompts: 0, total: 1000 }}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );
    expect(screen.queryByText(/re-authenticate/i)).toBeNull();
  });

  it("shows an informational runtimeError badge for a stdio call-time failure", () => {
    const runtimeError = "MCP error -32603: Not authenticated. Run 'railway login' first. Unauthorized";
    render(
      <ServerCard
        name="Railway"
        enabled={true}
        transport="stdio"
        target="npx -y @railway/mcp-server"
        authConfigured={false}
        isOAuth={false}
        syncedCount={3}
        errorCount={0}
        tokenCount={{ tools: 120, resources: 0, prompts: 0, total: 120, runtimeError }}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );

    const badge = screen.getByText("Sign-in expired");
    expect(badge.tagName.toLowerCase()).toBe("span");
    expect(badge.getAttribute("title")).toBe(runtimeError);
    expect(screen.queryByText(/re-authenticate/i)).toBeNull();
  });

  it("labels a non-auth runtimeError as 'call error'", () => {
    render(
      <ServerCard
        name="db"
        enabled={true}
        transport="stdio"
        target="npx db-mcp"
        authConfigured={false}
        isOAuth={false}
        syncedCount={1}
        errorCount={0}
        tokenCount={{ tools: 50, resources: 0, prompts: 0, total: 50, runtimeError: "Connection refused" }}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );

    const badge = screen.getByText("call error");
    expect(badge.tagName.toLowerCase()).toBe("span");
    expect(badge.getAttribute("title")).toBe("Connection refused");
  });

  it("does not show a runtimeError badge when there is no runtimeError", () => {
    render(
      <ServerCard
        name="ok"
        enabled={true}
        transport="stdio"
        target="npx ok-mcp"
        authConfigured={false}
        isOAuth={false}
        syncedCount={1}
        errorCount={0}
        tokenCount={{ tools: 80, resources: 0, prompts: 0, total: 80 }}
        onRefresh={() => {}}
        onClick={() => {}}
      />
    );

    expect(screen.queryByText("call error")).toBeNull();
    expect(screen.queryByText("Sign-in expired")).toBeNull();
  });
});

describe("describeTokenError", () => {
  it("classifies refresh token error as auth-like", () => {
    const { authLike, label } = describeTokenError("Invalid refresh token");
    expect(authLike).toBe(true);
    expect(label).toBe("Sign-in expired");
  });

  it("classifies generic error as non-auth", () => {
    const { authLike, label } = describeTokenError("fetch failed");
    expect(authLike).toBe(false);
    expect(label).toBe("token error");
  });

  it("classifies Unauthorized as auth-like", () => {
    const { authLike } = describeTokenError("tools/list: Unauthorized");
    expect(authLike).toBe(true);
  });
});
