import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServerDetail } from "../../src/renderer/components/ServerDetail";

const mockMcpx = {
  updateServer: vi.fn(),
  setServerEnabled: vi.fn().mockResolvedValue({}),
  removeServer: vi.fn().mockResolvedValue({})
};

const baseServer = {
  name: "next-devtools-mcp",
  enabled: true,
  transport: "stdio",
  target: "npx next-devtools-mcp@0.3.6",
  authBindings: [{ kind: "header", key: "Authorization", value: "secret://token" }],
  clients: [{ clientId: "claude", status: "SYNCED", managed: true }]
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("ServerDetail", () => {
  it("renders structured detail sections", () => {
    render(<ServerDetail server={baseServer} onBack={() => {}} onRefresh={() => {}} />);

    expect(screen.getAllByText("Configuration")).toHaveLength(2);
    expect(screen.getByText("Auth Bindings")).toBeDefined();
    expect(screen.getByText("Client Sync Status")).toBeDefined();
    expect(screen.getByText("Danger Zone")).toBeDefined();
    expect(screen.getByText("npx next-devtools-mcp@0.3.6")).toBeDefined();
  });

  it("enters edit mode and shows save actions", () => {
    render(<ServerDetail server={baseServer} onBack={() => {}} onRefresh={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Edit Configuration/i }));

    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeDefined();
    expect(screen.getByLabelText("Transport")).toBeDefined();
  });

  it("toggles enabled state", () => {
    render(<ServerDetail server={baseServer} onBack={() => {}} onRefresh={() => {}} />);

    fireEvent.click(screen.getByLabelText(/Disable next-devtools-mcp/i));

    expect(mockMcpx.setServerEnabled).toHaveBeenCalledWith("next-devtools-mcp", false);
  });
});
