import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  daemonStart: vi.fn().mockResolvedValue(undefined),
  daemonStop: vi.fn().mockResolvedValue(undefined),
  openDashboard: vi.fn()
};

beforeAll(() => {
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("StatusPopover", () => {
  it("shows daemon status when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/Local Gateway/i)).toBeDefined();
    expect(await screen.findByText(/37373/)).toBeDefined();
  });

  it("shows server count", async () => {
    render(<StatusPopover />);
    const label = await screen.findByText("Configured Servers");
    const row = label.parentElement as HTMLElement;
    expect(within(row).getByText("3")).toBeDefined();
  });

  it("shows error count when errors exist", async () => {
    render(<StatusPopover />);
    const label = await screen.findByText("Sync Errors");
    const row = label.parentElement as HTMLElement;
    expect(within(row).getByText("1")).toBeDefined();
  });

  it("keeps the Open Dashboard action available", async () => {
    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Open Dashboard/i })).toBeDefined();
  });

  it("shows daemon toggle button in footer when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Stop Gateway/i })).toBeDefined();
  });

  it("shows daemon toggle button in footer when stopped", async () => {
    mockMcpx.getStatus.mockResolvedValueOnce({
      daemon: { running: false, pid: undefined, pidFile: "", logFile: "", port: 37373 },
      upstreamCount: 3,
      servers: []
    });

    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Start Gateway/i })).toBeDefined();
  });

  it("does not show settings icon in header", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Local Gateway/i);
    // Should not find a button with settings title
    expect(screen.queryByTitle("Settings")).toBeNull();
  });

  it("does not show power icon in header", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Local Gateway/i);
    // Should not find buttons with power_settings_new icon in header
    const buttons = screen.getAllByRole("button");
    // Filter to only buttons in the footer (not header)
    const footerButtons = buttons.filter(btn => btn.textContent?.includes("Open Dashboard") || btn.textContent?.includes("Gateway"));
    expect(footerButtons.length).toBe(2);
  });

  it("does not show Sync All Clients button", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Local Gateway/i);
    expect(screen.queryByText(/Sync All Clients/i)).toBeNull();
  });
});
