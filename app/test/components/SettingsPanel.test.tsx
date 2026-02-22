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

    render(<SettingsPanel />);

    const autoUpdate = await screen.findByLabelText("Auto-update");
    const startOnLogin = await screen.findByLabelText("Start on login");

    expect((autoUpdate as HTMLInputElement).checked).toBe(true);
    expect((startOnLogin as HTMLInputElement).checked).toBe(false);
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

    render(<SettingsPanel />);
    const startOnLogin = await screen.findByLabelText("Start on login");
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

    render(<SettingsPanel />);
    const autoUpdate = await screen.findByLabelText("Auto-update");
    fireEvent.click(autoUpdate);

    expect(await screen.findByText("save failed")).toBeDefined();
  });
});
