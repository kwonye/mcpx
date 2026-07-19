import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextBudgetCard } from "../../src/renderer/components/ContextBudgetCard";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn()
    },
    writable: true
  });
});

describe("ContextBudgetCard", () => {
  it("renders total tokens in the subtitle", () => {
    render(<ContextBudgetCard totalTokens={50000} />);

    expect(screen.getByText(/~50k tokens active/)).toBeDefined();
  });

  it("shows alert state when total exceeds 256k threshold", () => {
    const { container } = render(<ContextBudgetCard totalTokens={300000} />);

    const alertBadge = screen.getByText(/256k Limit:/) as HTMLElement;
    expect(alertBadge).toBeDefined();
    expect(alertBadge.getAttribute("data-alert")).toBe("true");
  });

  it("shows normal state below 256k threshold", () => {
    const { container } = render(<ContextBudgetCard totalTokens={100000} />);

    const alertBadge = screen.getByText(/256k Limit:/) as HTMLElement;
    expect(alertBadge).toBeDefined();
    expect(alertBadge.getAttribute("data-alert")).toBe("false");
  });

  it("displays formatted token counts", () => {
    render(<ContextBudgetCard totalTokens={1500} />);

    expect(screen.getByText(/~2k tokens active/)).toBeDefined();
  });

  it("shows percentages for both limits", () => {
    render(<ContextBudgetCard totalTokens={128000} />);

    expect(screen.getByText(/256k Limit: 50\.0%/)).toBeDefined();
    expect(screen.getByText(/1M Limit: 12\.8%/)).toBeDefined();
  });

  it("handles zero tokens", () => {
    render(<ContextBudgetCard totalTokens={0} />);

    expect(screen.getByText(/0 tokens active/)).toBeDefined();
    expect(screen.getByText(/256k Limit: 0%/)).toBeDefined();
  });

  it("caps percentage display at 100%", () => {
    render(<ContextBudgetCard totalTokens={2000000} />);

    expect(screen.getByText(/256k Limit: 100\.0%/)).toBeDefined();
    expect(screen.getByText(/1M Limit: 100\.0%/)).toBeDefined();
  });
});
