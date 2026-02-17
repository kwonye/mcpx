import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPopover } from "../../src/renderer/components/StatusPopover";

const mockMcpx = {
  getStatus: vi.fn().mockResolvedValue({
    daemon: { running: true, pid: 1234, pidFile: "", logFile: "", port: 37373 },
    upstreamCount: 3,
    servers: [
      { name: "vercel", transport: "http", target: "https://mcp.vercel.com", authBindings: [], clients: [{ clientId: "claude", status: "ERROR", managed: true }] },
      { name: "github", transport: "http", target: "https://mcp.github.com", authBindings: [], clients: [{ clientId: "claude", status: "SYNCED", managed: true }] }
    ]
  }),
  syncAll: vi.fn(),
  daemonRestart: vi.fn(),
  openDashboard: vi.fn()
};

beforeAll(() => {
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("StatusPopover", () => {
  it("shows daemon status when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/running/i)).toBeDefined();
    expect(await screen.findByText(/37373/)).toBeDefined();
  });

  it("shows server count", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/3 servers/i)).toBeDefined();
  });

  it("shows error count when errors exist", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/1 error/i)).toBeDefined();
  });
});
