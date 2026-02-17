import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dashboard } from "../../src/renderer/components/Dashboard";

const mockMcpx = {
  getStatus: vi.fn().mockResolvedValue({
    daemon: { running: true, pid: 1234, pidFile: "", logFile: "", port: 37373 },
    upstreamCount: 2,
    servers: [
      {
        name: "vercel",
        transport: "http",
        target: "https://mcp.vercel.com",
        authBindings: [{ kind: "header", key: "Authorization", value: "secret://vercel_token" }],
        clients: [{ clientId: "claude", status: "SYNCED", managed: true }]
      },
      {
        name: "github",
        transport: "stdio",
        target: "npx @mcp/github",
        authBindings: [],
        clients: [{ clientId: "claude", status: "ERROR", managed: true }]
      }
    ]
  }),
  syncAll: vi.fn(),
  daemonStart: vi.fn(),
  daemonStop: vi.fn(),
  daemonRestart: vi.fn(),
  removeServer: vi.fn().mockResolvedValue({}),
  openDashboard: vi.fn(),
  registryList: vi.fn().mockResolvedValue({ servers: [], metadata: {} })
};

beforeAll(() => {
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("Dashboard", () => {
  it("renders server list with cards", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("vercel")).toBeDefined();
    expect(await screen.findByText("github")).toBeDefined();
  });

  it("shows tab navigation", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("Servers")).toBeDefined();
    expect(screen.getByText("Browse")).toBeDefined();
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("navigates to server detail on click", async () => {
    render(<Dashboard />);
    const vercelCard = await screen.findByText("vercel");
    fireEvent.click(vercelCard);
    expect(await screen.findByText("Back")).toBeDefined();
    expect(screen.getByText(/Authorization/)).toBeDefined();
  });

  it("shows daemon controls", async () => {
    render(<Dashboard />);
    expect(await screen.findByText(/Daemon running/i)).toBeDefined();
  });
});
