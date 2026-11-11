import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SettingsView } from "../../src/renderer/views/settings/SettingsView";
import { installApi, renderWithProviders, telemetryStatus, type TestApi } from "./helpers";

let api: TestApi;

describe("SettingsView", () => {
  beforeEach(() => {
    api = installApi();
  });

  it("saves desktop settings and reverts on failure", async () => {
    api.settings.update.mockRejectedValueOnce(new Error("disk full"));
    renderWithProviders(<SettingsView />);
    const login = await screen.findByRole("switch", { name: "Start at login" });
    expect(login).toHaveAttribute("aria-checked", "true");
    fireEvent.click(login);
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Start at login" })).toHaveAttribute("aria-checked", "true");
  });

  it("uses platform-neutral wording for notifications", async () => {
    renderWithProviders(<SettingsView />);
    expect(await screen.findByText("Tell me when a server stops working or needs me to sign in again.")).toBeInTheDocument();
    expect(screen.queryByText(/macOS notification/)).not.toBeInTheDocument();
  });

  it("moves secrets to the system keychain", async () => {
    renderWithProviders(<SettingsView />);
    const keychain = await screen.findByRole("switch", { name: "Use the macOS Keychain" });
    await waitFor(() => expect(keychain).not.toBeDisabled());
    fireEvent.click(keychain);
    await waitFor(() => expect(api.secrets.setBackend).toHaveBeenCalledWith("keychain"));
    expect(await screen.findByText("Secrets moved to the system keychain")).toBeInTheDocument();
  });

  it("updates telemetry choices and resets the anonymous id", async () => {
    renderWithProviders(<SettingsView />);
    fireEvent.click(await screen.findByRole("switch", { name: "Crash reports" }));
    await waitFor(() => expect(api.telemetry.updatePreferences).toHaveBeenCalledWith({ errorReportingEnabled: false }));
    fireEvent.click(screen.getByRole("button", { name: "Reset ID" }));
    expect(await screen.findByText("Anonymous ID reset")).toBeInTheDocument();
  });

  it("explains when diagnostics are disabled by the environment", async () => {
    api.telemetry.status.mockResolvedValue({ ...telemetryStatus(true), blockedReason: "environment" });
    renderWithProviders(<SettingsView />);
    expect(await screen.findByText(/turned off by an environment variable/)).toBeInTheDocument();
  });

  it.each([
    ["up-to-date", "You're on the latest version."],
    ["downloaded", "Update ready"],
    ["error", "Couldn't reach GitHub"]
  ])("shows the %s update result", async (status, message) => {
    api.app.checkForUpdates.mockResolvedValue({ status, message });
    renderWithProviders(<SettingsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("keeps gateway port and process id in the Advanced section", async () => {
    renderWithProviders(<SettingsView />);
    expect(await screen.findByText(/Listening on port 37373 · process 4242/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(api.gateway.restart).toHaveBeenCalled());
  });
});
