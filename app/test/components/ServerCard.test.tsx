import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServerCard } from "../../src/renderer/components/ServerCard";

const mockMcpx = {
  setServerEnabled: vi.fn().mockResolvedValue({})
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
        syncedCount={3}
        errorCount={0}
        onRefresh={() => {}}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByLabelText(/Disable vercel/i));

    expect(onClick).not.toHaveBeenCalled();
  });
});
