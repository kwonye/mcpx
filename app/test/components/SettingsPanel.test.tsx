import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../../src/renderer/components/SettingsPanel";

const mockMcpx = {
  getDesktopSettings: vi.fn(),
  updateDesktopSettings: vi.fn()
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
});
