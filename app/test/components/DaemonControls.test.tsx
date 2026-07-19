import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DaemonControls } from "../../src/renderer/components/DaemonControls";

const mockMcpx = {
  daemonStart: vi.fn().mockResolvedValue(undefined),
  daemonStop: vi.fn().mockResolvedValue(undefined)
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: mockMcpx,
    writable: true
  });
});

describe("DaemonControls", () => {
  it("shows Stop when daemon is running", async () => {
    render(<DaemonControls daemon={{ running: true, pid: 1234, port: 37373 }} onRefresh={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Stop/i })).toBeDefined();
  });

  it("shows Start when daemon is stopped", async () => {
    render(<DaemonControls daemon={{ running: false }} onRefresh={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Start/i })).toBeDefined();
  });

  it("stops the daemon when running", async () => {
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: true, pid: 1234, port: 37373 }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(mockMcpx.daemonStop).toHaveBeenCalledTimes(1);
  });

  it("starts the daemon when stopped", async () => {
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: false }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Start/i }));
    expect(mockMcpx.daemonStart).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when starting the daemon fails, and leaves the button enabled to retry", async () => {
    mockMcpx.daemonStart.mockRejectedValueOnce(new Error("EADDRINUSE: port already in use"));
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: false }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Start/i }));

    expect(await screen.findByText("EADDRINUSE: port already in use")).toBeDefined();
    const startButton = screen.getByRole("button", { name: /Start/i }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows an error message when stopping the daemon fails", async () => {
    mockMcpx.daemonStop.mockRejectedValueOnce(new Error("daemon not responding"));
    render(<DaemonControls daemon={{ running: true, pid: 1234, port: 37373 }} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Stop/i }));

    expect(await screen.findByText("daemon not responding")).toBeDefined();
  });

  it("clears a previous error and refreshes on a subsequent successful attempt", async () => {
    mockMcpx.daemonStart.mockRejectedValueOnce(new Error("EADDRINUSE: port already in use"));
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: false }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Start/i }));
    expect(await screen.findByText("EADDRINUSE: port already in use")).toBeDefined();

    // Next attempt resolves (mockResolvedValue base implementation applies again).
    fireEvent.click(screen.getByRole("button", { name: /Start/i }));

    await waitFor(() => {
      expect(screen.queryByText("EADDRINUSE: port already in use")).toBeNull();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
