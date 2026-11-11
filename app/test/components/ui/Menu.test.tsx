import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Menu } from "../../../src/renderer/components/ui";

describe("Menu", () => {
  it("opens a keyboard-navigable menu and runs the chosen item", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(<Menu label="More actions for github" items={[{ label: "Edit", onSelect: onEdit }, false, { label: "Remove", onSelect: onRemove, danger: true }]} />);
    const trigger = screen.getByRole("button", { name: "More actions for github" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Edit", "Remove"]);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.click(items[1]);
    expect(onRemove).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and returns focus to its trigger", () => {
    render(<Menu label="More" items={[{ label: "Edit", onSelect: () => {} }]} />);
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders nothing when every item is hidden", () => {
    const { container } = render(<Menu label="More" items={[false, null]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
