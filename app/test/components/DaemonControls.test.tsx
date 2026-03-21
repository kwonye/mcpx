import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(await screen.findByRole("button", { name: /Stop Daemon/i })).toBeDefined();
  });

  it("shows Start when daemon is stopped", async () => {
    render(<DaemonControls daemon={{ running: false }} onRefresh={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Start Daemon/i })).toBeDefined();
  });

  it("stops the daemon when running", async () => {
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: true, pid: 1234, port: 37373 }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Stop Daemon/i }));
    expect(mockMcpx.daemonStop).toHaveBeenCalledTimes(1);
  });

  it("starts the daemon when stopped", async () => {
    const onRefresh = vi.fn();
    render(<DaemonControls daemon={{ running: false }} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /Start Daemon/i }));
    expect(mockMcpx.daemonStart).toHaveBeenCalledTimes(1);
  });
});
