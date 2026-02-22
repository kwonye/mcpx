import { beforeEach, describe, expect, it, vi } from "vitest";
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
  addServer: vi.fn(),
  daemonStart: vi.fn(),
  daemonStop: vi.fn(),
  daemonRestart: vi.fn(),
  removeServer: vi.fn().mockResolvedValue({}),
  getDesktopSettings: vi.fn().mockResolvedValue({
    autoUpdateEnabled: true,
    startOnLoginEnabled: true
  }),
  updateDesktopSettings: vi.fn().mockResolvedValue({
    autoUpdateEnabled: false,
    startOnLoginEnabled: true
  }),
  openDashboard: vi.fn(),
  registryList: vi.fn().mockResolvedValue({ servers: [], metadata: {} }),
  registryGet: vi.fn(),
  registryPrepareAdd: vi.fn(),
  registryConfirmAdd: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("Dashboard", () => {
  it("renders server list with cards", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("vercel")).toBeDefined();
    expect(await screen.findByText("github")).toBeDefined();
  });

  it("shows tab navigation", async () => {
    render(<Dashboard />);
    expect(await screen.findByRole("button", { name: "My Servers" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Browse Registry" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Settings" })).toBeDefined();
  });

  it("navigates to server detail on click", async () => {
    render(<Dashboard />);
    const vercelCard = await screen.findByText("vercel");
    fireEvent.click(vercelCard);
    expect(await screen.findByTitle("Back")).toBeDefined();
    expect(screen.getByText(/Authorization/)).toBeDefined();
  });

  it("shows daemon controls", async () => {
    render(<Dashboard />);
    expect(await screen.findByText(/Daemon Running/i)).toBeDefined();
  });

  it("loads settings panel when settings tab is selected", async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByText("Settings"));

    expect(await screen.findByLabelText("Auto-update")).toBeDefined();
    expect(await screen.findByLabelText("Start on login")).toBeDefined();
    expect(mockMcpx.getDesktopSettings).toHaveBeenCalledTimes(1);
  });
});
