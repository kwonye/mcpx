import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../../src/renderer/App";
import { installApi, server, statusReport, telemetryStatus, type TestApi } from "./helpers";

let api: TestApi;

function setHash(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

describe("App shell", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.status.get.mockResolvedValue(statusReport({ servers: [server("github")] }));
      mock.telemetry.status.mockResolvedValue(telemetryStatus(false));
    });
  });
  afterEach(() => setHash(""));

  it("renders the dashboard shell immediately, before status loads", () => {
    api.status.get.mockReturnValue(new Promise(() => {}));
    setHash("#dashboard");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading servers" })).toBeInTheDocument();
  });

  it("shows a non-blocking first-run privacy notice that saves choices before acknowledging", async () => {
    setHash("#dashboard");
    render(<App />);
    expect(await screen.findByText("Help improve mcpx")).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Servers" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose…" }));
    fireEvent.click(screen.getByRole("switch", { name: "Anonymous usage analytics" }));
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    await waitFor(() => expect(api.telemetry.acknowledge).toHaveBeenCalled());
    expect(api.telemetry.updatePreferences).toHaveBeenCalledWith({ usageAnalyticsEnabled: false, errorReportingEnabled: true });
    expect(api.telemetry.updatePreferences.mock.invocationCallOrder[0]).toBeLessThan(api.telemetry.acknowledge.mock.invocationCallOrder[0]);
  });

  it("navigates between sections and honours main-process navigation", async () => {
    let navigate: ((route: string) => void) | undefined;
    api.app.onNavigate.mockImplementation((callback: (route: string) => void) => {
      navigate = callback;
      return () => {};
    });
    setHash("#dashboard");
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    fireEvent.click(within(nav).getByRole("button", { name: "Add-ons" }));
    expect(await screen.findByRole("heading", { name: "Add-ons", level: 1 })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Add-ons" })).toHaveAttribute("aria-current", "page");
    navigate?.("settings");
    expect(await screen.findByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument();
  });

  it("starts and stops the gateway from the sidebar", async () => {
    setHash("#dashboard");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.gateway.stop).toHaveBeenCalled());
  });

  it("never shows the privacy notice in the popover", async () => {
    setHash("#popover");
    render(<App />);
    expect(await screen.findByText("github")).toBeInTheDocument();
    expect(screen.queryByText("Help improve mcpx")).not.toBeInTheDocument();
  });
});
