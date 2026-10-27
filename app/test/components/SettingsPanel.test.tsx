import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../../src/renderer/components/SettingsPanel";

const mockMcpx = {
  getDesktopSettings: vi.fn(),
  updateDesktopSettings: vi.fn(),
  checkForUpdates: vi.fn(),
  getSecretBackend: vi.fn(),
  setSecretBackend: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("SettingsPanel", () => {
  it("renders toggles from saved settings", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: false
    });

    const { container } = render(<SettingsPanel />);
    // wait for loading to finish
    await screen.findByText("General Settings");

    const autoUpdate = container.querySelector('#toggle-autoUpdate') as HTMLInputElement;
    const startOnLogin = container.querySelector('#toggle-startOnLogin') as HTMLInputElement;

    expect(autoUpdate).toBeDefined();
    expect(autoUpdate.checked).toBe(true);

    expect(startOnLogin).toBeDefined();
    expect(startOnLogin.checked).toBe(false);
  });

  it("sends update patch when toggle is changed", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });
    mockMcpx.updateDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: false
    });

    const { container } = render(<SettingsPanel />);
    await screen.findByText("General Settings");

    const startOnLogin = container.querySelector('#toggle-startOnLogin') as HTMLInputElement;
    fireEvent.click(startOnLogin);

    await waitFor(() => {
      expect(mockMcpx.updateDesktopSettings).toHaveBeenCalledWith({
        startOnLoginEnabled: false
      });
    });
  });

  it("shows inline error when update fails", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });
    mockMcpx.updateDesktopSettings.mockRejectedValue(new Error("save failed"));

    const { container } = render(<SettingsPanel />);
    await screen.findByText("General Settings");

    const autoUpdate = container.querySelector('#toggle-autoUpdate') as HTMLInputElement;
    fireEvent.click(autoUpdate);

    expect(await screen.findByText("save failed")).toBeDefined();
  });

  it("checks for updates on demand and shows the result", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });
    mockMcpx.checkForUpdates.mockResolvedValue({
      status: "checking",
      message: "Update 1.2.3 found. Downloading now and it will install on the next restart."
    });

    render(<SettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Check for Updates/i }));

    await waitFor(() => {
      expect(mockMcpx.checkForUpdates).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Downloading now and it will install on the next restart/i)).toBeDefined();
  });

  it("renders product-aware restart copy", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });

    render(<SettingsPanel />);

    expect(await screen.findByText(/restart mcpx\./i)).toBeDefined();
  });

  it("switches secrets to the OS keychain from settings", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: false
    });
    mockMcpx.getSecretBackend.mockResolvedValue("file");
    mockMcpx.setSecretBackend.mockResolvedValue({
      backend: "keychain",
      changed: true,
      migrated: ["alpha"],
      preserved: [],
      removedFrom: "file"
    });

    const { container } = render(<SettingsPanel />);
    await screen.findByText("OS keychain");
    const toggle = container.querySelector("#toggle-secretBackend") as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockMcpx.setSecretBackend).toHaveBeenCalledWith("keychain");
    });
    expect(toggle.checked).toBe(true);
  });

  it("reverts the keychain toggle when switching backends fails", async () => {
    mockMcpx.getDesktopSettings.mockResolvedValue({
      autoUpdateEnabled: true,
      startOnLoginEnabled: false
    });
    mockMcpx.getSecretBackend.mockResolvedValue("file");
    mockMcpx.setSecretBackend.mockRejectedValue(new Error("keychain unavailable"));

    const { container } = render(<SettingsPanel />);
    await screen.findByText("OS keychain");
    fireEvent.click(container.querySelector("#toggle-secretBackend") as HTMLInputElement);

    expect(await screen.findByText("keychain unavailable")).toBeDefined();
    expect((container.querySelector("#toggle-secretBackend") as HTMLInputElement).checked).toBe(false);
  });
});
