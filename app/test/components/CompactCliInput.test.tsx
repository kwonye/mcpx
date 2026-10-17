import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CompactCliInput } from "../../src/renderer/components/CompactCliInput";
import { AUTO_DISMISS_DELAY_MS } from "../../src/renderer/hooks/useAutoDismiss";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn(),
      openDashboard: vi.fn()
    },
    writable: true
  });
});

async function submit(command: string): Promise<void> {
  const input = screen.getByLabelText(/Paste your mcpx add command/i);
  fireEvent.change(input, { target: { value: command } });
  const form = input.closest("form")!;
  await act(async () => {
    fireEvent.submit(form);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("CompactCliInput", () => {
  it("renders the add-server field and button", () => {
    render(<CompactCliInput onServerAdded={() => {}} />);

    expect(screen.getByLabelText(/Paste your mcpx add command/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Add/i })).toBeDefined();
  });

  it("submits the command via window.mcpx.invoke and reports success", async () => {
    const onServerAdded = vi.fn();
    (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ added: "slack" });
    render(<CompactCliInput onServerAdded={onServerAdded} />);

    const input = screen.getByLabelText(/Paste your mcpx add command/i);
    fireEvent.change(input, { target: { value: "claude mcp add slack --transport http https://mcp.slack.com/mcp" } });
    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(await screen.findByText('Added "slack"')).toBeDefined();
    expect(window.mcpx.invoke).toHaveBeenCalledWith(expect.anything(), "claude mcp add slack --transport http https://mcp.slack.com/mcp");
    expect(onServerAdded).toHaveBeenCalled();
  });

  describe("error feedback", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("surfaces an error message and auto-dismisses it after the delay", async () => {
      (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unrecognized command"));
      render(<CompactCliInput onServerAdded={() => {}} />);

      await submit("not a real command");

      expect(screen.getByText("Unrecognized command")).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_DISMISS_DELAY_MS);
      });

      expect(screen.queryByText("Unrecognized command")).toBeNull();
    });
  });
});
