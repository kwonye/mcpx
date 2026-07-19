import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { CliCommandInput } from "../../src/renderer/components/CliCommandInput";
import { AUTO_DISMISS_DELAY_MS } from "../../src/renderer/hooks/useAutoDismiss";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn()
    },
    writable: true
  });
});

describe("CliCommandInput", () => {
  it("renders supported commands on separate lines", () => {
    render(<CliCommandInput onServerAdded={() => {}} />);

    const supportsList = screen.getByRole("list", { name: "Supported commands" });
    const items = within(supportsList).getAllByRole("listitem");

    expect(items).toHaveLength(5);
    expect(within(items[0]).getByText("claude mcp add")).toBeDefined();
    expect(within(items[1]).getByText("codex mcp add")).toBeDefined();
    expect(within(items[2]).getByText("qwen mcp add")).toBeDefined();
    expect(within(items[3]).getByText("code --add-mcp")).toBeDefined();
    expect(within(items[4]).getByText("mcpx add")).toBeDefined();
  });

  describe("feedback auto-dismiss", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
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

    it("auto-dismisses success feedback after the delay", async () => {
      (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ added: "slack" });
      render(<CliCommandInput onServerAdded={() => {}} />);

      await submit("claude mcp add slack --transport http https://mcp.slack.com/mcp");

      expect(screen.getByText('Successfully added "slack"')).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_DISMISS_DELAY_MS);
      });

      expect(screen.queryByText('Successfully added "slack"')).toBeNull();
    });

    it("auto-dismisses error feedback after the delay", async () => {
      (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
      render(<CliCommandInput onServerAdded={() => {}} />);

      await submit("not a real command");

      expect(screen.getByText("boom")).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_DISMISS_DELAY_MS);
      });

      expect(screen.queryByText("boom")).toBeNull();
    });

    it("clears pending dismissal timer when a new submit updates the message", async () => {
      (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("first error"));
      render(<CliCommandInput onServerAdded={() => {}} />);

      await submit("bad command one");
      expect(screen.getByText("first error")).toBeDefined();

      // Advance partway through the first dismissal window, then resubmit.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_DISMISS_DELAY_MS - 1000);
      });

      (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("second error"));
      await submit("bad command two");
      expect(screen.getByText("second error")).toBeDefined();

      // Advance by the remainder of the first window: if the old timer wasn't
      // cleared, it would incorrectly dismiss the second message early.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText("second error")).toBeDefined();

      // The second message's own full delay should still dismiss it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_DISMISS_DELAY_MS);
      });
      expect(screen.queryByText("second error")).toBeNull();
    });
  });
});
