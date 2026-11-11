import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../../src/renderer/components/ui";
import { Popover } from "../../src/renderer/popover/Popover";
import { installApi, server, statusReport, type TestApi } from "./helpers";

let api: TestApi;

const renderPopover = () => render(<ToastProvider><Popover /></ToastProvider>);

describe("Popover", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.status.get.mockResolvedValue(statusReport({ servers: [server("github"), server("linear"), server("slack", { enabled: false })] }));
      mock.status.tokenCounts.mockResolvedValue({ gatewayRunning: true, counts: { github: { tools: 1, resources: 0, prompts: 0, total: 1200 } }, totalGlobalTokens: 1200, totalProjectTokens: {} });
      mock.auth.pending.mockResolvedValue([{ serverName: "linear" }]);
    });
  });

  it("puts servers needing attention first with one-click sign-in", async () => {
    renderPopover();
    const attention = await screen.findByRole("region", { name: "Needs attention" });
    await waitFor(() => expect(within(attention).getByText("linear")).toBeInTheDocument());
    fireEvent.click(within(attention).getByRole("button", { name: "Sign in" }));
    expect(api.auth.request).toHaveBeenCalledWith("linear");
    fireEvent.click(within(attention).getByRole("button", { name: "Dismiss sign-in reminder for linear" }));
    expect(api.auth.dismiss).toHaveBeenCalledWith("linear");
  });

  it("toggles servers and shows gateway state", async () => {
    renderPopover();
    expect(await screen.findByText("Running")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("switch", { name: "slack enabled" }));
    await waitFor(() => expect(api.servers.setEnabled).toHaveBeenCalledWith("slack", true));
    fireEvent.click(screen.getByRole("button", { name: "Stop gateway" }));
    await waitFor(() => expect(api.gateway.stop).toHaveBeenCalled());
  });

  it("hands Add server and Open mcpx to the dashboard", async () => {
    renderPopover();
    fireEvent.click(await screen.findByRole("button", { name: "Add server" }));
    expect(api.app.openDashboard).toHaveBeenCalledWith({ route: "servers:add" });
    fireEvent.click(screen.getByRole("button", { name: "Open mcpx" }));
    expect(api.app.openDashboard).toHaveBeenLastCalledWith(undefined);
  });

  it("offers retry when mcpx can't be reached", async () => {
    api.status.get.mockRejectedValueOnce(new Error("socket closed"));
    renderPopover();
    expect(await screen.findByText("socket closed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("github")).toBeInTheDocument();
  });

  it("has an empty state", async () => {
    api.status.get.mockResolvedValue(statusReport());
    api.auth.pending.mockResolvedValue([]);
    renderPopover();
    expect(await screen.findByText("No servers yet")).toBeInTheDocument();
  });
});
