import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CliCommandInput } from "../../src/renderer/components/CliCommandInput";

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
});
