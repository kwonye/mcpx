import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "../../../src/renderer/components/ui";

describe("Switch", () => {
  it("exposes role=switch with its state and name", () => {
    render(<Switch checked label="github enabled" onCheckedChange={() => {}} />);
    const control = screen.getByRole("switch", { name: "github enabled" });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("reports the next state when clicked", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="slack enabled" onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "slack enabled" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ignores clicks while busy and when disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked label="x" busy onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    rerender(<Switch checked label="x" disabled onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not trigger clicks on the row it sits in", () => {
    const onRow = vi.fn();
    render(<div onClick={onRow}><Switch checked label="x" onCheckedChange={() => {}} /></div>);
    fireEvent.click(screen.getByRole("switch"));
    expect(onRow).not.toHaveBeenCalled();
  });
});
