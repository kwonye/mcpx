import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServerCard } from "../../src/renderer/components/ServerCard";

describe("ServerCard", () => {
  it("renders server name and transport", () => {
    render(
      <ServerCard
        name="vercel"
        transport="http"
        target="https://mcp.vercel.com"
        authConfigured={true}
        syncedCount={3}
        errorCount={0}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("vercel")).toBeDefined();
    expect(screen.getByText("http")).toBeDefined();
  });

  it("shows error indicator when errors exist", () => {
    render(
      <ServerCard
        name="broken"
        transport="stdio"
        target="npx broken-mcp"
        authConfigured={false}
        syncedCount={1}
        errorCount={2}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/2 errors/i)).toBeDefined();
  });

  it("shows synced count", () => {
    render(
      <ServerCard
        name="test"
        transport="http"
        target="https://test.com/mcp"
        authConfigured={false}
        syncedCount={5}
        errorCount={0}
        onClick={() => {}}
      />
    );
    expect(screen.getByText(/5 synced/i)).toBeDefined();
  });
});
