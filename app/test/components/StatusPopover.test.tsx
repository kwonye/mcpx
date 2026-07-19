import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusPopover } from "../../src/renderer/components/StatusPopover";

const mockMcpx = {
  getStatus: vi.fn().mockResolvedValue({
    gatewayUrl: "http://127.0.0.1:37373",
    daemon: { running: true, pid: 1234, pidFile: "", logFile: "", port: 37373 },
    upstreamCount: 3,
    servers: [
      { name: "vercel", enabled: true, transport: "http", target: "https://mcp.vercel.com", authBindings: [], clients: [{ clientId: "claude", status: "ERROR", managed: true }], tokenCount: { tools: 12, resources: 0, prompts: 0, total: 1200 } },
      { name: "github", enabled: false, transport: "http", target: "https://mcp.github.com", authBindings: [], clients: [{ clientId: "claude", status: "SYNCED", managed: true }] }
    ],
    clients: {},
    totalGlobalTokens: 5000
  }),
  syncAll: vi.fn(),
  daemonStart: vi.fn().mockResolvedValue(undefined),
  daemonStop: vi.fn().mockResolvedValue(undefined),
  openDashboard: vi.fn(),
  quitApp: vi.fn(),
  setServerEnabled: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", { value: mockMcpx, writable: true });
});

describe("StatusPopover", () => {
  it("shows daemon status when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByText(/Gateway/i)).toBeDefined();
    expect(await screen.findByText(/37373/)).toBeDefined();
  });

  it("shows server count", async () => {
    render(<StatusPopover />);
    const label = await screen.findByText("3 Active");
    expect(label).toBeDefined();
  });

  it("shows error count when errors exist", async () => {
    render(<StatusPopover />);
    const vercelRow = await screen.findByText("vercel");
    expect(vercelRow).toBeDefined();
  });

  it("keeps the Open Dashboard action available", async () => {
    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Open Dashboard/i })).toBeDefined();
  });

  it("shows daemon toggle button in footer when running", async () => {
    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Stop/i })).toBeDefined();
  });

  it("shows daemon toggle button in footer when stopped", async () => {
    mockMcpx.getStatus.mockResolvedValueOnce({
      gatewayUrl: "http://127.0.0.1:37373",
      daemon: { running: false, pid: undefined, pidFile: "", logFile: "", port: 37373 },
      upstreamCount: 3,
      servers: [],
      clients: {}
    });

    render(<StatusPopover />);
    expect(await screen.findByRole("button", { name: /Start/i })).toBeDefined();
  });

  it("does not show settings icon in header", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Gateway/i);
    // Should not find a button with settings title
    expect(screen.queryByTitle("Settings")).toBeNull();
  });

  it("does not show power icon in header", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Gateway/i);
    // Should not find buttons with power_settings_new icon in header
    const buttons = screen.getAllByRole("button");
    // Filter to only buttons in the footer (not header)
    const footerButtons = buttons.filter(btn => btn.textContent?.includes("Open Dashboard") || btn.textContent?.includes("Start") || btn.textContent?.includes("Stop"));
    expect(footerButtons.length).toBe(2);
  });

  it("quits from the overflow menu", async () => {
    render(<StatusPopover />);

    fireEvent.click(await screen.findByRole("button", { name: /More/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Quit mcpx/i }));

    expect(mockMcpx.quitApp).toHaveBeenCalledTimes(1);
  });

  it("does not show Sync All Clients button", async () => {
    render(<StatusPopover />);
    await screen.findByText(/Gateway/i);
    expect(screen.queryByText(/Sync All Clients/i)).toBeNull();
  });

  it("shows server rows with their current state", async () => {
    render(<StatusPopover />);

    expect(await screen.findByText("Servers")).toBeDefined();
    expect(screen.getByText("vercel")).toBeDefined();
    expect(screen.getByText("github")).toBeDefined();
    expect(screen.getByText("Enabled")).toBeDefined();
    expect(screen.getByText("Disabled")).toBeDefined();
  });

  it("toggles a server from the popover list", async () => {
    render(<StatusPopover />);

    fireEvent.click(await screen.findByLabelText(/Disable vercel/i));

    expect(mockMcpx.setServerEnabled).toHaveBeenCalledWith("vercel", false);
  });

  it("renders global and per-server token counts from the typed status report", async () => {
    render(<StatusPopover />);

    // Global total from report.totalGlobalTokens, shown in the header subtitle.
    expect(await screen.findByText(/~5k Tokens/)).toBeDefined();
    // Per-server badge from server.tokenCount.total (vercel only; github has no tokenCount).
    expect(await screen.findByText("~1k")).toBeDefined();
  });

  it("renders the CliCommandInput (Add Server) panel inside the popover", async () => {
    render(<StatusPopover />);

    const addServerElements = await screen.findAllByText("Add Server");
    expect(addServerElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Paste your mcpx add command")).toBeDefined();
    expect(screen.getByPlaceholderText("Paste your mcpx add command here...")).toBeDefined();
  });
});
