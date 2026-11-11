import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Tabs } from "../../../src/renderer/components/ui";

function Harness() {
  const [value, setValue] = useState<"a" | "b" | "c">("a");
  return (
    <Tabs label="Add-ons" value={value} onChange={setValue} items={[{ id: "a", label: "Installed", count: 3 }, { id: "b", label: "Discover" }, { id: "c", label: "Skills" }]}>
      <p>Panel {value}</p>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders a tablist with one selected tab and its panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Add-ons" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Installed/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel a");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Installed/);
  });

  it("switches on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel b");
  });

  it("supports arrow keys with roving focus", () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: /Installed/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
  });
});
