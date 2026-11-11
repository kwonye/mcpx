import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Checkbox, Input, Select, Textarea } from "../../../src/renderer/components/ui";

describe("Input", () => {
  it("is labelled and describes itself with its hint", () => {
    render(<Input label="Name" hint="How this server appears" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAccessibleDescription("How this server appears");
  });

  it("marks itself invalid and announces the error instead of the hint", () => {
    render(<Input label="Name" hint="Hint" error="Give the server a name." />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Give the server a name.");
    expect(screen.getByRole("alert")).toHaveTextContent("Give the server a name.");
  });

  it("keeps a visually hidden label as the accessible name", () => {
    render(<Input label="Search plugins" hideLabel />);
    expect(screen.getByRole("textbox", { name: "Search plugins" })).toBeInTheDocument();
  });
});

describe("Textarea and Select", () => {
  it("label their controls", () => {
    render(
      <>
        <Textarea label="Arguments" />
        <Select label="Source"><option value="a">A</option></Select>
      </>
    );
    expect(screen.getByRole("textbox", { name: "Arguments" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Source" })).toBeInTheDocument();
  });
});

describe("Checkbox", () => {
  it("toggles through its label", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange}>notion</Checkbox>);
    fireEvent.click(screen.getByText("notion"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
